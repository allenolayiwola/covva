// Resolve hook: when an extensionless relative import is not found, retry with ".ts".
export async function resolve(specifier, context, next) {
  try {
    return await next(specifier, context);
  } catch (err) {
    if (err?.code === "ERR_MODULE_NOT_FOUND" && /^\.{1,2}\//.test(specifier) && !/\.[cm]?[jt]sx?$/.test(specifier)) {
      return next(`${specifier}.ts`, context);
    }
    throw err;
  }
}
