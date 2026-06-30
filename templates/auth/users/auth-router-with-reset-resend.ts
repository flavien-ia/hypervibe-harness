import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { eq, and, isNull, gt } from "drizzle-orm";
import { randomBytes } from "crypto";
import {
  createTRPCRouter,
  protectedProcedure,
  rateLimitedProcedure,
} from "~/server/api/trpc";
import { db } from "~/server/db";
import { users, passwordResetTokens } from "~/server/db/schema";
import { hashPassword, verifyPassword } from "~/lib/password";
import { sendMail, escapeHtml } from "~/server/mail";

const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1h

export const authRouter = createTRPCRouter({
  signup: rateLimitedProcedure
    .input(
      z.object({
        email: z.string().email(),
        password: z.string().min(8).max(200),
        name: z.string().min(1).max(100).optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const existing = await db.query.users.findFirst({
        where: eq(users.email, input.email),
      });
      if (existing) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Impossible de créer ce compte.",
        });
      }
      const passwordHash = await hashPassword(input.password);
      const [user] = await db
        .insert(users)
        .values({
          email: input.email,
          name: input.name ?? null,
          passwordHash,
        })
        .returning({ id: users.id, email: users.email });
      return { id: user!.id, email: user!.email };
    }),

  deleteAccount: protectedProcedure.mutation(async ({ ctx }) => {
    await db.delete(users).where(eq(users.id, ctx.session.user.id));
    return { success: true };
  }),

  /**
   * Send a password-reset email. Always returns success regardless of whether
   * the email exists, to avoid account enumeration.
   */
  requestPasswordReset: rateLimitedProcedure
    .input(z.object({ email: z.string().email() }))
    .mutation(async ({ input }) => {
      const user = await db.query.users.findFirst({
        where: eq(users.email, input.email),
      });

      if (user) {
        const rawToken = randomBytes(32).toString("base64url");
        const tokenHash = await hashPassword(rawToken);
        const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS);

        await db.insert(passwordResetTokens).values({
          userId: user.id,
          tokenHash,
          expiresAt,
        });

        const resetUrl = `${process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"}/reset-password?token=${rawToken}`;
        const safeUrl = escapeHtml(resetUrl);

        await sendMail({
          to: user.email,
          subject: "Réinitialisation de ton mot de passe",
          html: `<p>Pour choisir un nouveau mot de passe, clique sur ce lien :</p><p><a href="${safeUrl}">${safeUrl}</a></p><p>Le lien expire dans 1 heure et ne peut être utilisé qu'une fois. Si tu n'as pas demandé cette réinitialisation, ignore cet email.</p>`,
          text: `Pour choisir un nouveau mot de passe, ouvre ce lien : ${resetUrl}\n\nLe lien expire dans 1 heure et ne peut être utilisé qu'une fois. Si tu n'as pas demandé cette réinitialisation, ignore cet email.`,
        });
      } else {
        // No account for this email. Do equivalent CPU work (a throwaway hash)
        // so the response time does not reveal whether the account exists.
        await hashPassword(randomBytes(32).toString("base64url"));
      }

      return { success: true };
    }),

  /**
   * Consume a password-reset token and set a new password.
   * Token is single-use (consumedAt set after success) and TTL-bounded.
   */
  resetPassword: rateLimitedProcedure
    .input(
      z.object({
        token: z.string().min(1).max(200),
        newPassword: z.string().min(8).max(200),
      }),
    )
    .mutation(async ({ input }) => {
      const candidates = await db.query.passwordResetTokens.findMany({
        where: and(
          isNull(passwordResetTokens.consumedAt),
          gt(passwordResetTokens.expiresAt, new Date()),
        ),
      });

      let matched: (typeof candidates)[number] | null = null;
      for (const c of candidates) {
        if (await verifyPassword(input.token, c.tokenHash)) {
          matched = c;
          break;
        }
      }
      if (!matched) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Lien invalide ou expiré.",
        });
      }

      const newHash = await hashPassword(input.newPassword);
      await db
        .update(users)
        .set({ passwordHash: newHash })
        .where(eq(users.id, matched.userId));
      await db
        .update(passwordResetTokens)
        .set({ consumedAt: new Date() })
        .where(eq(passwordResetTokens.id, matched.id));

      return { success: true };
    }),
});
