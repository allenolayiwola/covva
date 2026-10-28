import { Tabs } from "@im/ui";

/** Family (what you pay for) ↔ Household (everyone's cover) switch shared by the two pages. */
export function FamilyTabs({ active }: { active: "family" | "household" }) {
  return (
    <Tabs
      className="w-fit max-w-full"
      active={active}
      items={[
        { key: "family", label: "Family you pay for", href: "/account/family" },
        { key: "household", label: "Household cover", href: "/account/household" },
      ]}
    />
  );
}
