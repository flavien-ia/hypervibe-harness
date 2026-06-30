import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import {
  createTRPCRouter,
  protectedProcedure,
  rateLimitedProcedure,
} from "~/server/api/trpc";
import { db } from "~/server/db";
import { users } from "~/server/db/schema";
import { hashPassword } from "~/lib/password";

export const authRouter = createTRPCRouter({
  /**
   * Create a new user account. Public - anyone can signup.
   * Rate-limited per IP to mitigate enumeration attacks.
   */
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
        // Don't disclose whether the email is taken (anti-enumeration).
        // Generic error matches the message we'd return for any 4xx.
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

  /**
   * Delete the current user's account. Requires authentication.
   * Cascades to accounts/sessions via the FK on userId.
   */
  deleteAccount: protectedProcedure.mutation(async ({ ctx }) => {
    await db.delete(users).where(eq(users.id, ctx.session.user.id));
    return { success: true };
  }),
});
