import { Car, Heart, House, Plane, Scale, Shield, ShieldPlus, Ship, Store, Users, type LucideIcon } from "lucide-react";
import { cn } from "@im/ui";

const ICONS: Record<string, LucideIcon> = {
  car: Car,
  motor: Car,
  plane: Plane,
  travel: Plane,
  "shield-plus": ShieldPlus,
  "personal-accident": ShieldPlus,
  home: House,
  heart: Heart,
  health: Heart,
  users: Users,
  "life-funeral": Users,
  store: Store,
  "sme-property": Store,
  scale: Scale,
  liability: Scale,
  ship: Ship,
  "marine-cargo": Ship,
};

export function categoryIcon(key: string | null | undefined): LucideIcon {
  return (key && ICONS[key]) || Shield;
}

/** Rounded mint tile with the category's icon (policy and request rows in the mockups). */
export function CategoryIcon({ icon, className, size = "md" }: { icon?: string | null; className?: string; size?: "sm" | "md" }) {
  const Icon = categoryIcon(icon);
  return (
    <span
      aria-hidden
      className={cn(
        "grid shrink-0 place-items-center rounded-xl bg-mist text-brand-deep",
        size === "md" ? "size-11" : "size-9",
        className,
      )}
    >
      <Icon className={size === "md" ? "size-5" : "size-4"} />
    </span>
  );
}
