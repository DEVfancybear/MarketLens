type RetryOptions = {
  limit?: number;
  methods?: string[];
  statusCodes?: number[];
};

export interface Options extends RequestInit {
  json?: unknown;
  retry?: number | RetryOptions;
  timeout?: number | false;
}

type BodyShortcut = {
  arrayBuffer(): Promise<ArrayBuffer>;
  blob(): Promise<Blob>;
  formData(): Promise<FormData>;
  json<T = unknown>(): Promise<T>;
  text(): Promise<string>;
};

type ResponsePromise = Promise<Response> & BodyShortcut;
type RequestMethod = (
  input: string | URL | Request,
  options?: Options,
) => ResponsePromise;

interface KyInstance extends RequestMethod {
  create(defaults?: Options): KyInstance;
  delete: RequestMethod;
  get: RequestMethod;
  head: RequestMethod;
  patch: RequestMethod;
  post: RequestMethod;
  put: RequestMethod;
}

type KyModule = { default: KyInstance };

export class HTTPError extends Error {
  readonly response: Response;
  readonly data: unknown;

  constructor(response: Response, data?: unknown) {
    super(`Request failed with status ${response.status}.`);
    this.name = "HTTPError";
    this.response = response;
    this.data = data;
  }

  static [Symbol.hasInstance](candidate: unknown): boolean {
    if (!candidate || typeof candidate !== "object") return false;
    const value = candidate as { name?: unknown; response?: unknown };
    return value.name === "HTTPError" && value.response instanceof Response;
  }
}

const importRealKy = new Function("return import('ky')") as () => Promise<KyModule>;

function decorateResponse(response: Promise<Response>): ResponsePromise {
  const decorated = response as ResponsePromise;
  decorated.arrayBuffer = async () => (await response).arrayBuffer();
  decorated.blob = async () => (await response).blob();
  decorated.formData = async () => (await response).formData();
  decorated.json = async <T = unknown>() => (await response).json() as Promise<T>;
  decorated.text = async () => (await response).text();
  return decorated;
}

function createBridge(defaults: Options = {}): KyInstance {
  const realInstance = importRealKy().then((loaded) => loaded.default.create(defaults));
  const invoke = (
    method: keyof Pick<KyInstance, "delete" | "get" | "head" | "patch" | "post" | "put"> | null,
    input: string | URL | Request,
    options?: Options,
  ): ResponsePromise =>
    decorateResponse(
      realInstance.then((instance) =>
        method === null ? instance(input, options) : instance[method](input, options),
      ),
    );
  const bridge = ((input: string | URL | Request, options?: Options) =>
    invoke(null, input, options)) as KyInstance;
  bridge.create = (options = {}) => createBridge({ ...defaults, ...options });
  for (const method of ["delete", "get", "head", "patch", "post", "put"] as const) {
    bridge[method] = (input, options) => invoke(method, input, options);
  }
  return bridge;
}

const ky = createBridge();
export default ky;

// TypeScript path mapping selects this shim for the test build, but deliberately
// leaves emitted `require("ky")` calls unchanged. Preloading this compiled module
// aliases only the CommonJS test process; native ESM import() above still loads Ky.
const currentModule = require.cache[__filename];
if (!currentModule) throw new Error("KY_TEST_SHIM_MODULE_NOT_CACHED");
require.cache[require.resolve("ky")] = currentModule;
