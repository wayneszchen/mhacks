import NextAuth from "next-auth";
import LinkedIn from "next-auth/providers/linkedin";
import Credentials from "next-auth/providers/credentials";

const hasLinkedIn = !!(process.env.LINKEDIN_CLIENT_ID && process.env.LINKEDIN_CLIENT_SECRET);

const handler = NextAuth({
  session: { strategy: "jwt" },
  secret: process.env.NEXTAUTH_SECRET || "dev-secret",
  providers: [
    ...(hasLinkedIn ? [
      LinkedIn({
        clientId: process.env.LINKEDIN_CLIENT_ID as string,
        clientSecret: process.env.LINKEDIN_CLIENT_SECRET as string,
        authorization: { params: { scope: "r_liteprofile r_emailaddress" } }
      })
    ] : []),
    ...(!hasLinkedIn ? [
      Credentials({
        name: 'Dev Login',
        credentials: {
          email: { label: 'Email', type: 'email' }
        },
        async authorize(credentials) {
          if (!credentials?.email) return null;
          return { id: 'dev-user', name: 'Dev User', email: credentials.email as string } as any;
        }
      })
    ] : [])
  ],
  callbacks: {
    async jwt({ token, account, profile }) {
      if (account) {
        token.provider = account.provider;
      }
      if (profile && typeof profile === 'object') {
        // attach minimal profile signals
        // @ts-ignore
        token.name = token.name || profile.localizedFirstName ? `${profile.localizedFirstName} ${profile.localizedLastName || ''}`.trim() : token.name;
      }
      return token;
    },
    async session({ session, token }) {
      // @ts-ignore
      session.provider = token.provider;
      return session;
    }
  }
});

export { handler as GET, handler as POST };
