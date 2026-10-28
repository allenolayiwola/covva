import type { Access, FieldAccess } from "payload";

/** Any signed-in CMS user (Covva staff). There is no public registration. */
export const staff: Access = ({ req }) => Boolean(req.user);

export const isAdmin: Access = ({ req }) => req.user?.role === "admin";

export const isAdminField: FieldAccess = ({ req }) => req.user?.role === "admin";

/** Staff see everything; the public (site reads use the Local API with access overridden) sees published docs only. */
export const publishedOrStaff: Access = ({ req }) => (req.user ? true : { _status: { equals: "published" } });

/** Admins manage every account; an editor may update only their own. */
export const isAdminOrSelf: Access = ({ req }) => {
  if (!req.user) return false;
  if (req.user.role === "admin") return true;
  return { id: { equals: req.user.id } };
};
