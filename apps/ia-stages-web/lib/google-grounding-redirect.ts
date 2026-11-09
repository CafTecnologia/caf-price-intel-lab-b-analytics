const GOOGLE_GROUNDING_HOST = "vertexaisearch.cloud.google.com";
const GOOGLE_GROUNDING_PATH = "/grounding-api-redirect/";
const REDIRECT_TIMEOUT_MS = 8_000;

export type GoogleGroundingRedirectResolution = {
  isGoogleGroundingRedirect: boolean;
  originalUrl: string;
  resolvedUrl?: string;
  status: "not_google_grounding" | "resolved" | "not_redirect" | "invalid_url" | "fetch_error";
  httpStatus?: number;
  error?: string;
};

export function isGoogleGroundingRedirectUrl(value: string) {
  try {
    const url = new URL(value);
    return url.hostname === GOOGLE_GROUNDING_HOST && url.pathname.startsWith(GOOGLE_GROUNDING_PATH);
  } catch {
    return false;
  }
}

export async function resolveGoogleGroundingRedirect(value: string): Promise<GoogleGroundingRedirectResolution> {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return { isGoogleGroundingRedirect: false, originalUrl: value, status: "invalid_url" };
  }

  if (url.hostname !== GOOGLE_GROUNDING_HOST || !url.pathname.startsWith(GOOGLE_GROUNDING_PATH)) {
    return { isGoogleGroundingRedirect: false, originalUrl: value, status: "not_google_grounding" };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REDIRECT_TIMEOUT_MS);
  try {
    const response = await fetch(value, {
      method: "HEAD",
      redirect: "manual",
      signal: controller.signal
    });
    const location = response.headers.get("location") || "";
    if (location) {
      return {
        isGoogleGroundingRedirect: true,
        originalUrl: value,
        resolvedUrl: new URL(location, value).toString(),
        status: "resolved",
        httpStatus: response.status
      };
    }
    return {
      isGoogleGroundingRedirect: true,
      originalUrl: value,
      status: "not_redirect",
      httpStatus: response.status
    };
  } catch (error) {
    return {
      isGoogleGroundingRedirect: true,
      originalUrl: value,
      status: "fetch_error",
      error: error instanceof Error ? error.message : String(error)
    };
  } finally {
    clearTimeout(timer);
  }
}
