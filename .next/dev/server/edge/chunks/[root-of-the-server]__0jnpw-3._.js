(globalThis["TURBOPACK"] || (globalThis["TURBOPACK"] = [])).push(["chunks/[root-of-the-server]__0jnpw-3._.js",
"[externals]/node:buffer [external] (node:buffer, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("node:buffer", () => require("node:buffer"));

module.exports = mod;
}),
"[externals]/node:async_hooks [external] (node:async_hooks, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("node:async_hooks", () => require("node:async_hooks"));

module.exports = mod;
}),
"[project]/janjez-socio/src/lib/supabase/middleware.ts [middleware-edge] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "createClient",
    ()=>createClient
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$janjez$2d$socio$2f$node_modules$2f40$supabase$2f$ssr$2f$dist$2f$module$2f$createServerClient$2e$js__$5b$middleware$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/janjez-socio/node_modules/@supabase/ssr/dist/module/createServerClient.js [middleware-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$janjez$2d$socio$2f$node_modules$2f$next$2f$dist$2f$esm$2f$api$2f$headers$2e$js__$5b$middleware$2d$edge$5d$__$28$ecmascript$29$__$3c$locals$3e$__ = __turbopack_context__.i("[project]/janjez-socio/node_modules/next/dist/esm/api/headers.js [middleware-edge] (ecmascript) <locals>");
var __TURBOPACK__imported__module__$5b$project$5d2f$janjez$2d$socio$2f$node_modules$2f$next$2f$dist$2f$esm$2f$server$2f$request$2f$cookies$2e$js__$5b$middleware$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/janjez-socio/node_modules/next/dist/esm/server/request/cookies.js [middleware-edge] (ecmascript)");
;
;
async function createClient() {
    const url = ("TURBOPACK compile-time value", "https://rousjavuooduvicaobuv.supabase.co");
    const key = ("TURBOPACK compile-time value", "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJvdXNqYXZ1b29kdXZpY2FvYnV2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU5NTI3OTQsImV4cCI6MjEwMTUyODc5NH0.quy_mQevbQ6neZ7DngwAxrIuBSSU0NihRE4rReb9UvM");
    if ("TURBOPACK compile-time falsy", 0) //TURBOPACK unreachable
    ;
    try {
        const cookieStore = await (0, __TURBOPACK__imported__module__$5b$project$5d2f$janjez$2d$socio$2f$node_modules$2f$next$2f$dist$2f$esm$2f$server$2f$request$2f$cookies$2e$js__$5b$middleware$2d$edge$5d$__$28$ecmascript$29$__["cookies"])();
        return (0, __TURBOPACK__imported__module__$5b$project$5d2f$janjez$2d$socio$2f$node_modules$2f40$supabase$2f$ssr$2f$dist$2f$module$2f$createServerClient$2e$js__$5b$middleware$2d$edge$5d$__$28$ecmascript$29$__["createServerClient"])(url, key, {
            cookies: {
                getAll () {
                    return cookieStore.getAll();
                },
                setAll (cookiesToSet) {
                    cookiesToSet.forEach(({ name, value, options })=>cookieStore.set(name, value, options));
                }
            }
        });
    } catch  {
        return null;
    }
}
}),
"[project]/janjez-socio/src/middleware.ts [middleware-edge] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "config",
    ()=>config,
    "middleware",
    ()=>middleware
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$janjez$2d$socio$2f$src$2f$lib$2f$supabase$2f$middleware$2e$ts__$5b$middleware$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/janjez-socio/src/lib/supabase/middleware.ts [middleware-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$janjez$2d$socio$2f$node_modules$2f$next$2f$dist$2f$esm$2f$api$2f$server$2e$js__$5b$middleware$2d$edge$5d$__$28$ecmascript$29$__$3c$locals$3e$__ = __turbopack_context__.i("[project]/janjez-socio/node_modules/next/dist/esm/api/server.js [middleware-edge] (ecmascript) <locals>");
var __TURBOPACK__imported__module__$5b$project$5d2f$janjez$2d$socio$2f$node_modules$2f$next$2f$dist$2f$esm$2f$server$2f$web$2f$spec$2d$extension$2f$response$2e$js__$5b$middleware$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/janjez-socio/node_modules/next/dist/esm/server/web/spec-extension/response.js [middleware-edge] (ecmascript)");
;
;
const CSP_HEADER = "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https:; style-src 'self' 'unsafe-inline' https:; img-src 'self' data: https:; font-src 'self' data: https:; connect-src 'self' https: wss:; frame-ancestors 'none'; base-uri 'self'; form-action 'self';";
async function middleware(request) {
    const supabase = await (0, __TURBOPACK__imported__module__$5b$project$5d2f$janjez$2d$socio$2f$src$2f$lib$2f$supabase$2f$middleware$2e$ts__$5b$middleware$2d$edge$5d$__$28$ecmascript$29$__["createClient"])();
    if (!supabase) {
        if ("TURBOPACK compile-time falsy", 0) //TURBOPACK unreachable
        ;
        return __TURBOPACK__imported__module__$5b$project$5d2f$janjez$2d$socio$2f$node_modules$2f$next$2f$dist$2f$esm$2f$server$2f$web$2f$spec$2d$extension$2f$response$2e$js__$5b$middleware$2d$edge$5d$__$28$ecmascript$29$__["NextResponse"].next();
    }
    const { data: { user } } = await supabase.auth.getUser();
    const pathname = new URL(request.url).pathname;
    const isAuthPage = pathname.startsWith("/auth/");
    const isAdminPage = pathname.startsWith("/admin");
    const isPublicTracking = pathname.startsWith("/orders/track");
    const isProtectedPage = isAdminPage || pathname.startsWith("/dashboard") || pathname.startsWith("/orders") && !isPublicTracking || pathname.startsWith("/pay") || pathname.startsWith("/wallet") || pathname.startsWith("/settings") || pathname.startsWith("/blog/write") || pathname.startsWith("/blog/drafts") || pathname.startsWith("/blog/my-articles") || pathname.startsWith("/blog/") && pathname.includes("/edit");
    const redirectTo = `/auth/sign-in?next=${encodeURIComponent(pathname)}`;
    if (isProtectedPage && !user) {
        const response = __TURBOPACK__imported__module__$5b$project$5d2f$janjez$2d$socio$2f$node_modules$2f$next$2f$dist$2f$esm$2f$server$2f$web$2f$spec$2d$extension$2f$response$2e$js__$5b$middleware$2d$edge$5d$__$28$ecmascript$29$__["NextResponse"].redirect(new URL(redirectTo, request.url));
        applySecurityHeaders(response, request.url);
        return response;
    }
    if (isAdminPage && user) {
        const metaRole = user.user_metadata?.role;
        if (metaRole !== "admin") {
            const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
            if (!profile || profile.role !== "admin") {
                const response = __TURBOPACK__imported__module__$5b$project$5d2f$janjez$2d$socio$2f$node_modules$2f$next$2f$dist$2f$esm$2f$server$2f$web$2f$spec$2d$extension$2f$response$2e$js__$5b$middleware$2d$edge$5d$__$28$ecmascript$29$__["NextResponse"].next();
                applySecurityHeaders(response, request.url);
                return response;
            }
        }
    }
    const returnTo = (()=>{
        try {
            return new URL(request.url).searchParams.get("next") || "/services";
        } catch  {
            return "/services";
        }
    })();
    if (isAuthPage && user) {
        const response = __TURBOPACK__imported__module__$5b$project$5d2f$janjez$2d$socio$2f$node_modules$2f$next$2f$dist$2f$esm$2f$server$2f$web$2f$spec$2d$extension$2f$response$2e$js__$5b$middleware$2d$edge$5d$__$28$ecmascript$29$__["NextResponse"].redirect(new URL(returnTo, request.url));
        applySecurityHeaders(response, request.url);
        return response;
    }
    const response = __TURBOPACK__imported__module__$5b$project$5d2f$janjez$2d$socio$2f$node_modules$2f$next$2f$dist$2f$esm$2f$server$2f$web$2f$spec$2d$extension$2f$response$2e$js__$5b$middleware$2d$edge$5d$__$28$ecmascript$29$__["NextResponse"].next();
    applySecurityHeaders(response, request.url);
    return response;
}
function applySecurityHeaders(response, requestUrl) {
    const pathname = requestUrl ? new URL(requestUrl).pathname : "";
    response.headers.set("Content-Security-Policy", CSP_HEADER);
    response.headers.set("X-Content-Type-Options", "nosniff");
    response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
    response.headers.set("X-Frame-Options", "DENY");
    response.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    response.headers.set("X-XSS-Protection", "1; mode=block");
    response.headers.set("Strict-Transport-Security", "max-age=63072000; includeSubDomains");
    response.headers.set("Cross-Origin-Opener-Policy", "same-origin");
    response.headers.set("Cross-Origin-Resource-Policy", "same-origin");
    if (!pathname.startsWith("/_next/static/")) {
        response.headers.set("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0, private");
    }
}
const config = {
    matcher: [
        "/dashboard/:path*",
        "/auth/:path*",
        "/admin",
        "/admin/:path*",
        "/orders/:path*",
        "/pay",
        "/wallet/:path*",
        "/settings/:path*"
    ]
};
}),
]);

//# sourceMappingURL=%5Broot-of-the-server%5D__0jnpw-3._.js.map