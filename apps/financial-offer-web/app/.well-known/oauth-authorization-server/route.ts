import { authErrorResponse, authorizationServerMetadata } from "@offer/lib/chatgpt-auth";

export const runtime = "nodejs";

export function GET() {
  try {
    return Response.json(authorizationServerMetadata(), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return authErrorResponse(error);
  }
}
