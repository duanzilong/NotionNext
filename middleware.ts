import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';
import { NextRequest, NextResponse } from 'next/server';
import { checkStrIsNotionId, getLastPartOfUrl } from '@/lib/utils';
import { idToUuid } from 'notion-utils';
import BLOG from './blog.config';

// 关键：强制指定边缘运行时，使其兼容 EdgeOne 环境
export const runtime = 'edge';

// 匹配规则（保持不变）
export const config = {
  matcher: ['/((?!.*\\..*|_next|/sign-in|/auth).*)', '/', '/(api|trpc)(.*)'],
};

// 限制登录访问的路由（保持不变）
const isTenantRoute = createRouteMatcher([
  '/user/organization-selector(.*)',
  '/user/orgid/(.*)',
  '/dashboard',
  '/dashboard/(.*)',
]);

// 限制权限访问的路由（保持不变）
const isTenantAdminRoute = createRouteMatcher([
  '/admin/(.*)/memberships',
  '/admin/(.*)/domain',
]);

/**
 * 未配置 Clerk 时的备用中间件（处理 Notion 重定向）
 */
const noAuthMiddleware = async (req: NextRequest) => {
  if (BLOG['UUID_REDIRECT']) {
    let redirectJson: Record<string, string> = {};
    try {
      const response = await fetch(`${req.nextUrl.origin}/redirect.json`);
      if (response.ok) {
        redirectJson = (await response.json()) as Record<string, string>;
      }
    } catch (err) {
      // 边缘环境不支持 console.error 的详细信息，但可以保留
      console.error('Error fetching redirect.json:', err);
    }
    let lastPart = getLastPartOfUrl(req.nextUrl.pathname) as string;
    if (checkStrIsNotionId(lastPart)) {
      lastPart = idToUuid(lastPart);
    }
    if (lastPart && redirectJson[lastPart]) {
      const redirectToUrl = req.nextUrl.clone();
      redirectToUrl.pathname = '/' + redirectJson[lastPart];
      console.log(`Redirect from ${req.nextUrl.pathname} to ${redirectToUrl.pathname}`);
      return NextResponse.redirect(redirectToUrl, 308);
    }
  }
  return NextResponse.next();
};

/**
 * 主鉴权中间件（根据环境变量决定是否启用 Clerk）
 */
const authMiddleware = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
  ? clerkMiddleware((auth, req) => {
      const { userId } = auth();
      if (isTenantRoute(req)) {
        if (!userId) {
          const url = new URL('/sign-in', req.url);
          url.searchParams.set('redirectTo', req.url);
          return NextResponse.redirect(url);
        }
      }
      if (isTenantAdminRoute(req)) {
        auth().protect((has) => {
          return (
            has({ permission: 'org:sys_memberships:manage' }) ||
            has({ permission: 'org:sys_domains_manage' })
          );
        });
      }
      return NextResponse.next();
    })
  : noAuthMiddleware;

export default authMiddleware;