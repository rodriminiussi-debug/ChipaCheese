"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogOut, UserRound } from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { NAV } from "@/lib/nav";
import { BrandLogo, BrandMark } from "@/components/brand/brand";
import { ThemeToggle } from "@/components/theme/theme";
import { can, ROLE_LABELS, type Role } from "@/lib/rbac";
import { logoutAction } from "@/features/auth/actions";

export function AppSidebar({ user }: { user: { name: string; role: Role } }) {
  const pathname = usePathname();
  const isActive = (href: string) =>
    pathname === href ||
    (href !== "/produccion" && pathname.startsWith(href + "/")) ||
    (href === "/produccion" && pathname === href);

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <Link href="/" className="flex items-center gap-2 px-1 py-1.5" aria-label="Chipa Cheese — inicio">
          <BrandLogo className="w-36 group-data-[collapsible=icon]:hidden dark:rounded-md dark:bg-white/95 dark:px-1.5 dark:py-1" />
          <BrandMark className="hidden size-8 group-data-[collapsible=icon]:block" />
        </Link>
      </SidebarHeader>
      <SidebarContent>
        {NAV.map((section) => {
          const items = section.items.filter((i) => can(user.role, i.permission));
          if (!items.length) return null;
          return (
            <SidebarGroup key={section.title}>
              <SidebarGroupLabel>{section.title}</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {items.map((item) => (
                    <SidebarMenuItem key={item.href}>
                      <SidebarMenuButton asChild isActive={isActive(item.href)} tooltip={item.title}>
                        <Link href={item.href}>
                          <item.icon />
                          <span>{item.title}</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          );
        })}
      </SidebarContent>
      <SidebarFooter>
        <div className="px-2 py-1 text-xs group-data-[collapsible=icon]:hidden">
          <div className="font-medium" data-testid="current-user">
            {user.name}
          </div>
          <div className="text-muted-foreground">{ROLE_LABELS[user.role]}</div>
        </div>
        <SidebarMenuButton asChild isActive={pathname === "/cuenta"} tooltip="Mi cuenta">
          <Link href="/cuenta">
            <UserRound />
            <span>Mi cuenta</span>
          </Link>
        </SidebarMenuButton>
        <ThemeToggle />
        <form action={logoutAction}>
          <SidebarMenuButton type="submit" tooltip="Salir">
            <LogOut />
            <span>Salir</span>
          </SidebarMenuButton>
        </form>
      </SidebarFooter>
    </Sidebar>
  );
}
