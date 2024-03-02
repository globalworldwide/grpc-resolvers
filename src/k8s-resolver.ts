import * as grpc from '@grpc/grpc-js';
import { uriToString } from '@grpc/grpc-js/build/src/uri-parser.js';

import type { K8SListener } from './internal/k8s-watch.js';
import * as k8sWatch from './internal/k8s-watch.js';
import { makeLogger } from './internal/logging.js';
import { ChannelOptions } from './channel-options.js';

const logger = makeLogger('k8s-resolver');

export class K8SResolver implements grpc.experimental.Resolver {
  public static getDefaultAuthority(target: grpc.experimental.GrpcUri): string {
    return target.path;
  }

  readonly #target: grpc.experimental.GrpcUri;
  readonly #listener: grpc.experimental.ResolverListener;
  readonly #watch: K8SListener;
  readonly #defaultResolutionError: grpc.StatusObject;
  readonly #serviceName: string;
  readonly #portName: string;
  // readonly #channelOptions: grpc.ChannelOptions

  #lastNotifyTimeMS = 0;
  #timeoutId: NodeJS.Timeout | undefined = undefined;
  #hasEndpoints: boolean;

  constructor(
    target: grpc.experimental.GrpcUri,
    listener: grpc.experimental.ResolverListener,
    channelOptions: grpc.ChannelOptions,
  ) {
    this.#target = target;
    this.#listener = listener;
    this.#defaultResolutionError = {
      code: grpc.status.UNAVAILABLE,
      details: `No endpoints available for target ${uriToString(this.#target)}`,
      metadata: new grpc.Metadata(),
    };
    this.#serviceName = K8SResolver.getDefaultAuthority(this.#target);
    this.#portName = channelOptions[ChannelOptions.portName] ?? 'grpc';
    // this.#channelOptions = channelOptions

    this.#watch = this.onWatchChange.bind(this);
    k8sWatch.addListener(this.#serviceName, this.#watch);

    this.#hasEndpoints = this.hasEndpoints();
  }

  public updateResolution(): void {
    // do not notify until we've seen an update from the k8s watch at least once
    if (!this.#hasEndpoints) {
      return;
    }

    // If the service is not actually running, then grpc-js starts calling updateResolution
    // as fast as we answer. In order to stop that from turning into a busy loop, we never
    // resolve more than once every 250ms
    if (!this.#timeoutId) {
      const nowMS = Date.now();
      const delayMS = Math.max(0, 250 - (nowMS - this.#lastNotifyTimeMS)); // never resolve more than once every 500ms
      this.#timeoutId = setTimeout(this.onTimeout.bind(this), delayMS);
    }
  }

  public destroy(): void {
    clearTimeout(this.#timeoutId);
    this.#timeoutId = undefined;
    this.#lastNotifyTimeMS = 0;

    k8sWatch.removeListener(this.#serviceName, this.#watch);
  }

  private onWatchChange(): void {
    this.#hasEndpoints = true;

    if (this.#timeoutId) {
      clearTimeout(this.#timeoutId);
      this.#timeoutId = undefined;
    }

    this.notify();
  }

  private onTimeout(): void {
    this.#timeoutId = undefined;

    this.notify();
  }

  private notify(): void {
    this.#lastNotifyTimeMS = Date.now();

    const endpoints = this.getEndpoints();
    logger.debug?.(`mapped ${this.#serviceName} ${this.#portName} -> ${JSON.stringify(endpoints)}`);

    if (endpoints.length > 0) {
      this.#listener.onSuccessfulResolution(
        endpoints,
        { loadBalancingConfig: [{ round_robin: {} }], methodConfig: [] },
        null,
        null,
        {},
      );
    } else {
      this.#listener.onError(this.#defaultResolutionError);
    }
  }

  private hasEndpoints(): boolean {
    return k8sWatch
      .getEndpoints(this.#serviceName)
      .some((e) => e.addresses.some((a) => a.portName === this.#portName));
  }

  private getEndpoints(): grpc.experimental.Endpoint[] {
    return k8sWatch
      .getEndpoints(this.#serviceName)
      .map((e) => ({
        addresses: e.addresses.filter((a) => a.portName === this.#portName),
      }))
      .filter((e) => e.addresses.length > 0);
  }
}
