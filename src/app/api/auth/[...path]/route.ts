import { authHandler } from "@/lib/auth/server";

export const { GET, POST, PUT, DELETE, PATCH } = authHandler.handler();
