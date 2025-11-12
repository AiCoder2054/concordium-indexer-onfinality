/* eslint-disable @typescript-eslint/no-explicit-any */

declare const module: NodeModule;

type NextTick = (callback: (...args: any[]) => void, ...args: any[]) => void;
type Hrtime = (time?: [number, number]) => [number, number];

const globalRef = globalThis as Record<string, any>;
const processStart = Date.now();

function createNextTick(): NextTick {
  return (callback, ...args) => {
    if (typeof queueMicrotask === 'function') {
      queueMicrotask(() => {
        callback(...args);
      });
    } else {
      Promise.resolve()
        .then(() => callback(...args))
        .catch((error) => {
          setTimeout(() => {
            throw error;
          }, 0);
        });
    }
  };
}

function createHrtime(): Hrtime {
  return (time) => {
    const nowMs =
      typeof performance !== 'undefined' && typeof performance.now === 'function'
        ? performance.now()
        : Date.now();

    let seconds = Math.floor(nowMs / 1000);
    let nanoseconds = Math.floor((nowMs % 1000) * 1e6);

    if (time && Array.isArray(time)) {
      seconds -= time[0];
      nanoseconds -= time[1];
      if (nanoseconds < 0) {
        nanoseconds += 1e9;
        seconds -= 1;
      }
    }

    return [seconds, nanoseconds];
  };
}

const processShim: Record<string, any> =
  typeof globalRef.process === 'object' && globalRef.process !== null
    ? globalRef.process
    : {};

if (typeof processShim.env !== 'object' || processShim.env === null) {
  processShim.env = {};
}

if (!processShim.stdout || typeof processShim.stdout.write !== 'function') {
  processShim.stdout = {
    write: (...args: unknown[]) => {
      console.log(...args);
      return true;
    },
  };
}

if (!processShim.stderr || typeof processShim.stderr.write !== 'function') {
  processShim.stderr = {
    write: (...args: unknown[]) => {
      console.error(...args);
      return true;
    },
  };
}

if (typeof processShim.nextTick !== 'function') {
  processShim.nextTick = createNextTick();
}

if (typeof processShim.hrtime !== 'function') {
  processShim.hrtime = createHrtime();
}

if (typeof processShim.pid !== 'number') {
  processShim.pid = 0;
}

if (typeof processShim.cwd !== 'function') {
  processShim.cwd = () => '/';
}

if (typeof processShim.chdir !== 'function') {
  processShim.chdir = () => {
    throw new Error('process.chdir is not supported in this environment');
  };
}

if (typeof processShim.uptime !== 'function') {
  processShim.uptime = () => (Date.now() - processStart) / 1000;
}

if (typeof processShim.version !== 'string') {
  processShim.version = '';
}

if (typeof processShim.versions !== 'object' || processShim.versions === null) {
  processShim.versions = {};
}

if (typeof processShim.emit !== 'function') {
  processShim.emit = () => false;
}

if (typeof processShim.on !== 'function') {
  processShim.on = () => processShim;
}

if (typeof processShim.once !== 'function') {
  processShim.once = () => processShim;
}

if (typeof processShim.off !== 'function') {
  processShim.off = () => processShim;
}

if (typeof processShim.addListener !== 'function') {
  processShim.addListener = () => processShim;
}

if (typeof processShim.removeListener !== 'function') {
  processShim.removeListener = () => processShim;
}

if (typeof processShim.removeAllListeners !== 'function') {
  processShim.removeAllListeners = () => processShim;
}

globalRef.process = processShim;

const moduleCtor = module?.constructor as any;

if (
  moduleCtor &&
  typeof moduleCtor._resolveFilename === 'function' &&
  !moduleCtor.__concordiumProcessPatched
) {
  const resolveFilename = moduleCtor._resolveFilename;
  moduleCtor._resolveFilename = function patchedResolveFilename(
    request: string,
    parent: unknown,
    isMain: boolean,
    options: unknown,
  ) {
    if (request === 'process') {
      return __filename;
    }
    return resolveFilename.call(this, request, parent, isMain, options);
  };
  moduleCtor.__concordiumProcessPatched = true;
}

if (typeof require === 'function' && require.cache) {
  require.cache[__filename] = module;
}

export = processShim;
