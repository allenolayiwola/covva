import { Tabs } from "@im/ui";

export function SubNav({ active }: { active: "inbox" | "templates" | "contacts" }) {
  return (
    <Tabs
      active={active}
      items={[
        { key: "inbox", label: "Inbox", href: "/whatsapp" },
        { key: "templates", label: "Templates", href: "/whatsapp/templates" },
        { key: "contacts", label: "Contacts", href: "/whatsapp/contacts" },
      ]}
    />
  );
}
