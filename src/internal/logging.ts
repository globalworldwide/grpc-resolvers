import { experimental } from '@grpc/grpc-js';
import { LogVerbosity } from '@grpc/grpc-js/build/src/constants.js';
import { isTracerEnabled } from '@grpc/grpc-js/build/src/logging.js';

type TraceFunction = (text: string, md?: unknown) => void;

interface IError extends Error {
  code?: string;
}
type ErrorFunction = (e: IError, text?: string) => void;

class Logger {
  #tracer;
  #debugTraceFunction: TraceFunction;
  #infoTraceFunction: TraceFunction;
  #errorTraceFunction: TraceFunction;
  #errorErrorFunction: ErrorFunction;

  constructor(tracer: string) {
    this.#tracer = tracer;
    this.#debugTraceFunction = this.#trace?.bind(this, LogVerbosity.DEBUG);
    this.#infoTraceFunction = this.#trace?.bind(this, LogVerbosity.INFO);
    this.#errorTraceFunction = this.#trace?.bind(this, LogVerbosity.ERROR);
    this.#errorErrorFunction = this.#error?.bind(this, LogVerbosity.ERROR);
  }

  public get debug(): TraceFunction | undefined {
    return isTracerEnabled(this.#tracer) ? this.#debugTraceFunction : undefined;
  }

  public get info(): TraceFunction | undefined {
    return isTracerEnabled(this.#tracer) ? this.#infoTraceFunction : undefined;
  }

  public get error(): TraceFunction | undefined {
    return isTracerEnabled(this.#tracer) ? this.#errorTraceFunction : undefined;
  }

  public get errorError(): ErrorFunction | undefined {
    return isTracerEnabled(this.#tracer) ? this.#errorErrorFunction : undefined;
  }

  #trace(severity: LogVerbosity, text: string, md?: unknown): void {
    return experimental.trace(severity, this.#tracer, text + (md ? ` ${JSON.stringify(md)}` : ''));
  }

  #error(severity: LogVerbosity, e: IError, text?: string): void {
    return experimental.trace(
      severity,
      this.#tracer,
      text + (e ? ` ${JSON.stringify({ code: e.code, name: e.name, message: e.message })}` : ''),
    );
  }
}

export function makeLogger(tracer: string): Logger {
  return new Logger(tracer);
}
