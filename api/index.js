let appPromise;

async function getApp() {
  if (!appPromise) {
    appPromise = import("../backend/src/app.js").then((m) => m.default);
  }
  return appPromise;
}

export default async function handler(req, res) {
  try {
    const app = await getApp();
    return app(req, res);
  } catch (err) {
    // Surface initialization failures instead of opaque invocation crashes.
    console.error("Vercel function bootstrap error:", err);
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({
      ok: false,
      error: {
        code: "BOOTSTRAP_FAILED",
        message: err?.message || "Server bootstrap failed",
      },
    }));
  }
}
