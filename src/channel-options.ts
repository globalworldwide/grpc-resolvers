export enum ChannelOptions {
  /**
   * The name of the port to search the kubernetes endpoint slice for.
   * type: string
   * default: 'grpc'
   */
  portName = 'gww.k8s.port_name',

  /**
   * The map of authority to host:port to use for fixed resolution.
   * If a host is not provided for an authority, 127.0.0.1 will be used.
   * If a port is not provided for an authority, 443 will be used.
   * type: Record<string, string>
   * default: {}
   */
  authorityMap = 'gww.fixed.authority_map',

  /**
   * The minimum time between resolutions in milliseconds
   * type: number
   * default: 1000
   */
  minTimeBetweenResolutionsMS = 'gww.fixed.min_time_between_resolutions_ms',
}
