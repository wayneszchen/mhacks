import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export async function middleware(req: NextRequest) {
  // No authentication required - allow all requests
  return NextResponse.next();
}

export const config = {
  matcher: []
};
