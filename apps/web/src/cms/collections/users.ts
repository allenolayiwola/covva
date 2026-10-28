import type { CollectionConfig } from "payload";
import { isAdmin, isAdminField, isAdminOrSelf, staff } from "../access";

/**
 * CMS accounts (Payload's own auth, separate from Supabase Auth). Covva staff only: there is no
 * sign-up screen; the first admin is created by `pnpm --filter @im/web cms:seed`, later accounts by
 * an admin here. See docs/CMS.md for the edge protection of /cms until SSO is wired.
 */
export const Users: CollectionConfig = {
  slug: "users",
  labels: { singular: "CMS user", plural: "CMS users" },
  auth: {
    tokenExpiration: 60 * 60 * 8,
    maxLoginAttempts: 5,
    lockTime: 10 * 60 * 1000,
    cookies: { sameSite: "Lax", secure: process.env.NODE_ENV === "production" },
  },
  admin: {
    useAsTitle: "email",
    group: "Settings",
    description: "Covva staff accounts for this CMS. Admins manage accounts and can reset passwords; editors change content.",
  },
  access: { read: staff, create: isAdmin, update: isAdminOrSelf, delete: isAdmin, admin: ({ req }) => Boolean(req.user) },
  fields: [
    { name: "name", type: "text", required: true },
    {
      name: "role",
      type: "select",
      required: true,
      defaultValue: "editor",
      options: [
        { label: "Admin (content + accounts)", value: "admin" },
        { label: "Editor (content)", value: "editor" },
      ],
      access: { update: isAdminField, create: isAdminField },
    },
  ],
};
