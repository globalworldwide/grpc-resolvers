import { experimental } from '@grpc/grpc-js';
import { LogVerbosity } from '@grpc/grpc-js/build/src/constants.js';
import { isTracerEnabled } from '@grpc/grpc-js/build/src/logging.js';

type TraceFunction = (text: string) => void;

class Logger {
  #tracer;
  #debugFunction: TraceFunction;
  #infoFunction: TraceFunction;
  #errorFunction: TraceFunction;

  constructor(tracer: string) {
    this.#tracer = tracer;
    this.#debugFunction = this.#trace?.bind(this, LogVerbosity.DEBUG);
    this.#infoFunction = this.#trace?.bind(this, LogVerbosity.INFO);
    this.#errorFunction = this.#trace?.bind(this, LogVerbosity.ERROR);
  }

  public get debug(): TraceFunction | undefined {
    return isTracerEnabled(this.#tracer) ? this.#debugFunction : undefined;
  }

  public get info(): TraceFunction | undefined {
    return isTracerEnabled(this.#tracer) ? this.#infoFunction : undefined;
  }

  public get error(): TraceFunction | undefined {
    return isTracerEnabled(this.#tracer) ? this.#errorFunction : undefined;
  }

  #trace(severity: LogVerbosity, text: string): void {
    return experimental.trace(severity, this.#tracer, text);
  }
}

export function makeLogger(tracer: string): Logger {
  return new Logger(tracer);
}
