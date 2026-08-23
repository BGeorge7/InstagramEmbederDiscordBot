export type LogLevel = "debug" | "info" | "warn" | "error";

export interface Logger {
  debug(message: string, context?: Readonly<Record<string, unknown>>): void;
  info(message: string, context?: Readonly<Record<string, unknown>>): void;
  warn(message: string, context?: Readonly<Record<string, unknown>>): void;
  error(message: string, context?: Readonly<Record<string, unknown>>): void;
}

const levelPriority: Readonly<Record<LogLevel, number>> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export function errorContext(error: unknown): Readonly<Record<string, unknown>> {
  if (error instanceof Error) {
    return {
      errorName: error.name,
      errorMessage: error.message,
      ...(error.stack === undefined ? {} : { stack: error.stack }),
    };
  }

  return { error: String(error) };
}

export function createLogger(minimumLevel: LogLevel): Logger {
  function write(
    level: LogLevel,
    message: string,
    context: Readonly<Record<string, unknown>> = {},
  ): void {
    if (levelPriority[level] < levelPriority[minimumLevel]) return;

    const record = JSON.stringify({
      timestamp: new Date().toISOString(),
      level,
      message,
      ...context,
    });

    if (level === "error") {
      console.error(record);
    } else if (level === "warn") {
      console.warn(record);
    } else {
      console.log(record);
    }
  }

  return {
    debug: (message, context) => write("debug", message, context),
    info: (message, context) => write("info", message, context),
    warn: (message, context) => write("warn", message, context),
    error: (message, context) => write("error", message, context),
  };
}
