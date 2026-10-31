import { NextRequest, NextResponse } from "next/server";
import { authHandler } from "@/lib/auth/server";

export default async function proxy(request: NextRequest) {
  const response = await authHandler.middleware({ loginUrl: "/auth/sign-in" })(
    request,
  );
  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get("location") ?? "";
    if (location.includes("/auth/sign-in")) {
      const next = encodeURIComponent(
        request.nextUrl.pathname + request.nextUrl.search,
      );
      return NextResponse.redirect(
        new URL(`/auth/sign-in?next=${next}`, request.url),
      );
    }
  }
  return response;
}

export const config = {
  matcher: [
    "/account/:path*",
    "/events/new",
    "/events/:id/edit",
    "/wishlist",
    "/my-events",
    "/notifications",
  ],
};