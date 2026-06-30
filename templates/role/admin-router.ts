// tRPC router for the admin "Manage users + roles" page.
// All procedures protected by isAdmin() (the credentials admin from /add-auth).

import { z } from "zod";
import { eq, desc } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { db } from "~/server/db";
import { users } from "~/server/db/schema";
import { isAdmin } from "~/server/auth";
import { ROLES, type Role } from "~/lib/roles";

async function assertAdmin() {
  if (!(await isAdmin())) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Admin uniquement." });
  }
}

const RoleSchema = z.enum(ROLES as readonly [string, ...string[]]);

export const adminUsersRouter = createTRPCRouter({
  list: protectedProcedure.query(async () => {
    await assertAdmin();
    const rows = await db
      .select({
        id: users.id,
        email: users.email,
        name: users.name,
        image: users.image,
        roles: users.roles,
        createdAt: users.emailVerified,
      })
      .from(users)
      .orderBy(desc(users.emailVerified));
    return rows;
  }),

  setRoles: protectedProcedure
    .input(z.object({ userId: z.string().min(1), roles: z.array(RoleSchema) }))
    .mutation(async ({ input }) => {
      await assertAdmin();
      await db
        .update(users)
        .set({ roles: input.roles as Role[] })
        .where(eq(users.id, input.userId));
      return { ok: true };
    }),
});
