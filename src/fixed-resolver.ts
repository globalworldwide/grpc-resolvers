import * as grpc from '@grpc/grpc-js';
import { WellKnownChannelOptions } from './well-known-channel-options.js';
import { makeLogger } from './internal/logging.js';
import { statusOrFromValue } from '@grpc/grpc-js/build/src/call-interface.js';

const logger = makeLogger('fixed-resolver');

export class FixedResolver implements grpc.experimental.Resolver {
  public static getDefaultAuthority(target: grpc.experimental.GrpcUri): string {
    return target.path;
  }

  readonly #minTimeBetweenResolutionsMS: number;
  readonly authorityMap: Record<string, string | undefined>;
  #target: grpc.experimental.GrpcUri;
  #listener: grpc.experimental.ResolverListener;
  // #channelOptions: grpc.ChannelOptions;
  #lastResolveTimeMS = 0;
  #timeoutId: NodeJS.Timeout | undefined = undefined;

  constructor(
    target: grpc.experimental.GrpcUri,
    listener: grpc.experimental.ResolverListener,
    channelOptions: grpc.ChannelOptions,
  ) {
    this.#target = target;
    this.#listener = listener;
    // this.#channelOptions = channelOptions;

    this.authorityMap = channelOptions[WellKnownChannelOptions.authorityMap] ?? {};
    this.#minTimeBetweenResolutionsMS =
      channelOptions[WellKnownChannelOptions.minTimeBetweenResolutionsMS] ?? 1000;
  }

  public updateResolution(): void {
    // If the service is not actually running, then grpc-js starts calling updateResolution
    // as fast as we answer. In order to stop that from turning into a busy loop, we never
    // resolve more than once every 1000ms (configurable via channel optiona)
    if (!this.#timeoutId) {
      const nowMS = Date.now();
      const delayMS = Math.max(
        0,
        this.#minTimeBetweenResolutionsMS - (nowMS - this.#lastResolveTimeMS),
      );
      this.#timeoutId = setTimeout(this.onTimeout.bind(this), delayMS);
    }
  }

  public destroy(): void {
    clearTimeout(this.#timeoutId);
    this.#timeoutId = undefined;
    this.#lastResolveTimeMS = 0;
  }

  private getHostPort(authority: string): [string, number] {
    const hostPort = this.authorityMap[authority];
    let pathSplit = hostPort?.split(':') ?? [];

    let host = pathSplit[0];
    if (!host) {
      host = '127.0.0.1';
    }

    let port = Number(pathSplit[1]);
    if (!Number.isInteger(port) || port === 0) {
      port = 443;
    }

    return [host, port];
  }

  private onTimeout(): void {
    this.#lastResolveTimeMS = Date.now();
    this.#timeoutId = undefined;

    const authority = FixedResolver.getDefaultAuthority(this.#target);
    const [host, port] = this.getHostPort(authority);
    const endpoint: grpc.experimental.Endpoint = { addresses: [{ host, port }] };

    logger.debug?.(`mapped ${this.#target.path} to ${host}:${port}`);
    this.#listener(statusOrFromValue([endpoint]), {}, null, '');
  }
}
