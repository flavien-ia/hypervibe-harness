// Router tRPC des abonnements push. À wirer dans appRouter (root.ts) sous la clé
// "push". Prérequis : auth en mode users (protectedProcedure) + table
// pushSubscriptions (schema). Posé par /add-push-notification.
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { pushSubscriptions } from "~/server/db/schema";

export const pushRouter = createTRPCRouter({
  // Enregistre l'abonnement push d'un appareil (idempotent par endpoint).
  subscribe: protectedProcedure
    .input(
      z.object({
        endpoint: z.string().url(),
        p256dh: z.string().min(1),
        auth: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.db.query.pushSubscriptions.findFirst({
        where: eq(pushSubscriptions.endpoint, input.endpoint),
      });
      if (existing) {
        await ctx.db
          .update(pushSubscriptions)
          .set({ userId: ctx.session.user.id, p256dh: input.p256dh, auth: input.auth })
          .where(eq(pushSubscriptions.endpoint, input.endpoint));
      } else {
        await ctx.db.insert(pushSubscriptions).values({
          userId: ctx.session.user.id,
          endpoint: input.endpoint,
          p256dh: input.p256dh,
          auth: input.auth,
        });
      }
      return { ok: true };
    }),

  unsubscribe: protectedProcedure
    .input(z.object({ endpoint: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .delete(pushSubscriptions)
        .where(
          and(
            eq(pushSubscriptions.endpoint, input.endpoint),
            eq(pushSubscriptions.userId, ctx.session.user.id),
          ),
        );
      return { ok: true };
    }),

  // Indique si l'utilisateur a au moins un appareil abonné.
  status: protectedProcedure.query(async ({ ctx }) => {
    const subs = await ctx.db.query.pushSubscriptions.findMany({
      where: eq(pushSubscriptions.userId, ctx.session.user.id),
    });
    return { subscribed: subs.length > 0, devices: subs.length };
  }),
});
