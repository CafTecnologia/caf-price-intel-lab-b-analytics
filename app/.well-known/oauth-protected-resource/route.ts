import { authErrorResponse, protectedResourceMetadata } from "@offer/lib/chatgpt-auth";

export const runtime = "nodejs";

export function GET() {
  try {
    return Response.json(protectedResourceMetadata(), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return authErrorResponse(error);
  }
}
