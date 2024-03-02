import * as k8s from '@kubernetes/client-node';
import shuffle from 'lodash.shuffle';
import { makeLogger } from './logging.js';

const logger = makeLogger('k8s-resolver');

export type K8SListener = () => void;

let watch: k8s.Watch | undefined;
let watchRequest: AbortController | undefined;
const listenersByServiceName = new Map<string, Set<K8SListener>>();
const endpointsByEndpointName = new Map<string, Endpoint>();
const grpcEndpointByServiceName = new Map<string, GrpcEndpoint[]>();

type EndpointPort = { portName: string; port: number };

type Endpoint = {
  endpointName: string;
  serviceName: string;
  hosts: string[];
  ports: EndpointPort[];
};

type GrpcAddress = {
  host: string;
  portName: string;
  port: number;
};

type GrpcEndpoint = {
  addresses: GrpcAddress[];
};

export function addListener(serviceName: string, listener: K8SListener): void {
  logger.debug?.(`watch addListener ${serviceName}`);

  const listeners = listenersByServiceName.get(serviceName) ?? new Set();
  listenersByServiceName.set(serviceName, listeners);
  listeners.add(listener);

  void startWatch();
}

export function removeListener(serviceName: string, listener: K8SListener): void {
  logger.debug?.(`watch removeListener ${serviceName}`);

  const listeners = listenersByServiceName.get(serviceName) ?? new Set();
  listenersByServiceName.set(serviceName, listeners);
  listeners.delete(listener);
  if (listeners.size === 0) {
    listenersByServiceName.delete(serviceName);

    // MSED do we want to stop here?
    stopWatch();
  }
}

export function getEndpoints(serviceName: string): GrpcEndpoint[] {
  return grpcEndpointByServiceName.get(serviceName) ?? [];
}

function hasListeners(): boolean {
  return listenersByServiceName.size > 0;
}

function normalizeEndpointSlice(endpointSlice: k8s.V1EndpointSlice): Endpoint | undefined {
  logger.debug?.(`endpoint slice = ${JSON.stringify(endpointSlice)}`);
  const endpointName = endpointSlice.metadata?.name;
  if (!endpointName) {
    return undefined;
  }

  return {
    endpointName,
    serviceName: endpointSlice.metadata?.labels?.['kubernetes.io/service-name'] ?? '',
    hosts: shuffle(
      ((endpointSlice.endpoints as k8s.V1Endpoint[] | undefined) ?? [])
        .filter(
          (endpoint) =>
            endpoint.conditions?.ready &&
            endpoint.conditions.serving &&
            !endpoint.conditions.terminating,
        )
        .flatMap((endpoint) => endpoint.addresses),
    ),
    ports: (endpointSlice.ports ?? [])
      .filter((p) => p.name && p.name.length > 0 && p.protocol === 'TCP' && p.port !== undefined)
      .map((p) => ({ portName: p.name as string, port: p.port as number })),
  };
}

async function startWatch(): Promise<void> {
  try {
    if (watch !== undefined || !hasListeners()) {
      return;
    }

    // load kubeconfig from default location and determine namespace
    const kc = new k8s.KubeConfig();
    kc.loadFromDefault();
    const namespace = kc.contexts[0]?.namespace;
    if (!namespace) {
      throw new Error('No namespace found in KubeConfig');
    }

    // get an initial list of endpoint slices
    const discoveryApi = kc.makeApiClient(k8s.DiscoveryV1Api);
    const endpointSlices = await discoveryApi.listNamespacedEndpointSlice({ namespace });

    // save a copy of the old endpoint map
    const oldEndpoints = new Map(endpointsByEndpointName);

    // build the new endpoint map
    const newEndpoints = endpointSlices.items
      .map(normalizeEndpointSlice)
      .filter((e): e is Endpoint => !!e);
    endpointsByEndpointName.clear();
    for (const newEndpoint of newEndpoints) {
      endpointsByEndpointName.set(newEndpoint.endpointName, newEndpoint);

      // remove the endpoint from the old endpoint map
      oldEndpoints.delete(newEndpoint.endpointName);
    }

    // find the list of all the service names that have changed
    const changedServiceNames = new Set<string>();
    for (const endpoint of oldEndpoints.values()) {
      changedServiceNames.add(endpoint.serviceName);
    }
    for (const endpoint of newEndpoints.values()) {
      changedServiceNames.add(endpoint.serviceName);
    }

    // notify the listeners
    for (const changedServiceName of changedServiceNames) {
      notifyListeners(changedServiceName);
    }

    // no start the watch, picking up from where the initial list left off
    watch = new k8s.Watch(kc);
    watchRequest = await watch.watch(
      `/apis/discovery.k8s.io/v1/namespaces/${namespace}/endpointslices`,
      { resourceVersion: endpointSlices.metadata?.resourceVersion },
      (type, apiObj) => {
        // convert to endpoints
        const endpoint = normalizeEndpointSlice(apiObj);
        if (!endpoint) {
          return;
        }

        // update the endpoint map
        if (type === 'DELETED') {
          endpointsByEndpointName.delete(endpoint.endpointName);
        } else if (type === 'ADDED' || type === 'MODIFIED') {
          endpointsByEndpointName.set(endpoint.endpointName, endpoint);
        }

        // notify the listeners
        notifyListeners(endpoint.serviceName);
      },
      (e) => {
        logger.error?.(`watch terminated ${e.message}`);
        backoffWatch();
      },
    );
  } catch (e) {
    // swallow all errors in the watch
    logger.error?.(`watch start error ${e.message}`);
    backoffWatch();
  }
}

function backoffWatch(): void {
  // MSED - add proper backoff logic on restarting the watch
  stopWatch();
  setTimeout(() => {
    void startWatch();
  }, 1000);
}

function stopWatch(): void {
  try {
    if (watchRequest) {
      watchRequest.abort();
    }
  } catch (e) {
    // swallow errors attempting to stop the watch, nothing we can do about it
    logger.error?.(`watch stop error: ${e.message}`);
  }
  watch = undefined;
  watchRequest = undefined;
}

function rebuildGrpcEndpoints(serviceName: string): void {
  grpcEndpointByServiceName.set(
    serviceName,
    Array.from(endpointsByEndpointName.values())
      .filter((e) => e.serviceName === serviceName)
      .flatMap((e) => {
        return e.hosts.flatMap((host) => {
          return e.ports.map((port) => ({ addresses: [{ host, ...port }] }) satisfies GrpcEndpoint);
        });
      }),
  );
}

function notifyListeners(serviceName: string): void {
  rebuildGrpcEndpoints(serviceName);

  const listeners = listenersByServiceName.get(serviceName);
  if (!listeners || listeners.size === 0) {
    return;
  }
  for (const listener of listeners) {
    logger.debug?.(`watch notifyOne ${serviceName}`);
    listener();
  }
}
