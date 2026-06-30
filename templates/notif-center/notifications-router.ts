// Router tRPC du centre de notifications. À wirer dans appRouter (root.ts) sous la
// clé "notifications". Prérequis : auth users (protectedProcedure) + table
// `notifications`. Posé par /add-notification-center.
import { z } from "zod";
import { and, count, desc, eq } from "drizzle-orm";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { notifications } from "~/server/db/schema";

export const notificationsRouter = createTRPCRouter({
  // Les N notifications les plus récentes de l'utilisateur.
  list: protectedProcedure
    .input(z.object({ limit: z.number().min(1).max(50).default(20) }).optional())
    .query(async ({ ctx, input }) => {
      return ctx.db.query.notifications.findMany({
        where: eq(notifications.userId, ctx.session.user.id),
        orderBy: [desc(notifications.createdAt)],
        limit: input?.limit ?? 20,
      });
    }),

  // Nombre de notifications non lues (pour la pastille de la cloche).
  unreadCount: protectedProcedure.query(async ({ ctx }) => {
    const [row] = await ctx.db
      .select({ c: count() })
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, ctx.session.user.id),
          eq(notifications.read, false),
        ),
      );
    return row?.c ?? 0;
  }),

  markRead: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .update(notifications)
        .set({ read: true })
        .where(
          and(
            eq(notifications.id, input.id),
            eq(notifications.userId, ctx.session.user.id),
          ),
        );
      return { ok: true };
    }),

  markAllRead: protectedProcedure.mutation(async ({ ctx }) => {
    await ctx.db
      .update(notifications)
      .set({ read: true })
      .where(
        and(
          eq(notifications.userId, ctx.session.user.id),
          eq(notifications.read, false),
        ),
      );
    return { ok: true };
  }),
});
