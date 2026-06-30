// ─── Password reset tokens (appended by /add-auth when email is configured) ──
//
// Stores hashed reset tokens. We hash via scrypt the same way as passwords -
// never store raw tokens in DB. Tokens expire 1h after creation. One use only:
// `consumedAt` flips when the user successfully resets their password.

export const passwordResetTokens = createTable(
  "password_reset_token",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", {
      mode: "date",
      withTimezone: true,
    }).notNull(),
    consumedAt: timestamp("consumed_at", {
      mode: "date",
      withTimezone: true,
    }),
    createdAt: timestamp("created_at", {
      mode: "date",
      withTimezone: true,
    })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => ({
    userIdIdx: index("password_reset_user_id_idx").on(t.userId),
    tokenHashIdx: index("password_reset_token_hash_idx").on(t.tokenHash),
  }),
);
