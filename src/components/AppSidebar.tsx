import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { LayoutDashboard, TableProperties, BarChart3, Star, Settings, Layers, Briefcase } from "lucide-react";
import { NavLink } from "@/components/NavLink";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarHeader,
  SidebarSeparator,
  SidebarFooter,
  useSidebar,
} from "@/components/ui/sidebar";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useTheme } from "@/hooks/useTheme";
import { Sun, Moon, TrendingUp, ChevronDown, Database } from "lucide-react";
import { getSavedBrokers, setActiveBroker, getActiveBroker, BROKERS } from "@/lib/brokerConfig";

const mainItems = [
  { title: "Dashboard", url: "/", icon: LayoutDashboard, shortcut: "1" },
  { title: "Option Chain", url: "/option-chain", icon: TableProperties, shortcut: "2" },
  { title: "OI Analysis", url: "/oi-analysis", icon: BarChart3, shortcut: "3" },
  { title: "Watchlist", url: "/watchlist", icon: Star, shortcut: "4" },
];

const tradingItems = [
  { title: "Strategy Builder", url: "/strategy-builder", icon: Layers, shortcut: "5" },
  { title: "Position Tracker", url: "/position-tracker", icon: Briefcase, shortcut: "6" },
];

const settingItems = [
  { title: "Broker API Keys", url: "/broker-settings", icon: Settings },
];

export function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const { isDark, toggle: toggleTheme } = useTheme();
  const navigate = useNavigate();

  const [activeBroker, setActiveBrokerState] = useState(getActiveBroker());
  const [proxyBroker, setProxyBroker] = useState<string | null>(null);

  useEffect(() => {
    fetch("http://localhost:4002/health")
      .then(r => r.json())
      .then(d => { if (d.activeBroker) setProxyBroker(d.activeBroker); })
      .catch(() => {});

    const handleBrokerChanged = () => setActiveBrokerState(getActiveBroker());
    window.addEventListener("brokerChanged", handleBrokerChanged);
    return () => window.removeEventListener("brokerChanged", handleBrokerChanged);
  }, []);

  const savedBrokers = getSavedBrokers();
  const optionChainBrokers = savedBrokers.filter(b => b.brokerId === "dhan" || b.brokerId === "fyers");
  const effectiveBrokerId = activeBroker?.brokerId || proxyBroker;
  const effectiveBrokerInfo = BROKERS.find(b => b.id === effectiveBrokerId);

  const handleSwitchBroker = (brokerId: string) => {
    setActiveBroker(brokerId);
    setActiveBrokerState(getActiveBroker());
    window.dispatchEvent(new CustomEvent("brokerChanged", { detail: { brokerId } }));
  };

  const renderNavItems = (items: { title: string; url: string; icon: typeof LayoutDashboard; shortcut?: string }[]) =>
    items.map((item) => (
      <SidebarMenuItem key={item.title}>
        <SidebarMenuButton asChild>
          <NavLink
            to={item.url}
            end={item.url === "/"}
            className="group relative flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[13px] text-sidebar-foreground transition-all duration-150 hover:bg-sidebar-accent hover:text-foreground"
            activeClassName="bg-primary/10 text-primary font-medium before:absolute before:left-0 before:top-1/2 before:-translate-y-1/2 before:h-4 before:w-[3px] before:rounded-r-full before:bg-primary"
          >
            <item.icon className="h-4 w-4 shrink-0" />
            {!collapsed && (
              <>
                <span className="flex-1">{item.title}</span>
                {"shortcut" in item && item.shortcut && (
                  <kbd className="text-2xs font-mono text-muted-foreground/30 group-hover:text-muted-foreground/50 bg-transparent border-0 px-0">⌘{item.shortcut}</kbd>
                )}
              </>
            )}
          </NavLink>
        </SidebarMenuButton>
      </SidebarMenuItem>
    ));

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="border-b border-sidebar-border px-4 py-3">
        <div className="flex items-center gap-2.5">
          <div className="h-7 w-7 rounded-lg bg-primary flex items-center justify-center shadow-glow-sm">
            <TrendingUp className="h-4 w-4 text-primary-foreground" />
          </div>
          {!collapsed && (
            <div>
              <h1 className="text-sm font-bold text-foreground tracking-tight leading-none">IOH007</h1>
              <p className="text-2xs text-muted-foreground mt-0.5 tracking-[0.15em] uppercase">India OptionsHub</p>
            </div>
          )}
        </div>
      </SidebarHeader>

      <SidebarContent className="px-2 py-2">
        <SidebarGroup>
          <SidebarGroupLabel className="text-2xs uppercase tracking-[0.15em] text-muted-foreground/50 px-2 mb-1 font-medium">Markets</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu className="space-y-0.5">{renderNavItems(mainItems)}</SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarSeparator className="my-2 opacity-30" />

        <SidebarGroup>
          <SidebarGroupLabel className="text-2xs uppercase tracking-[0.15em] text-muted-foreground/50 px-2 mb-1 font-medium">Trading Tools</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu className="space-y-0.5">{renderNavItems(tradingItems)}</SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarSeparator className="my-2 opacity-30" />

        {/* ── Data Source (Broker) Selector ── */}
        <SidebarGroup>
          {!collapsed && (
            <SidebarGroupLabel className="text-2xs uppercase tracking-[0.15em] text-muted-foreground/50 px-2 mb-1 font-medium">Data Source</SidebarGroupLabel>
          )}
          <SidebarGroupContent>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="flex items-center gap-2 w-full rounded-lg px-2.5 py-1.5 text-[12px] text-sidebar-foreground transition-all duration-150 hover:bg-sidebar-accent hover:text-foreground">
                  <span className="text-sm shrink-0">{effectiveBrokerInfo?.logo || <Database className="h-4 w-4" />}</span>
                  {!collapsed && (
                    <>
                      <span className="flex-1 text-left font-medium">
                        {effectiveBrokerInfo?.name || effectiveBrokerId || "No Broker"}
                      </span>
                      {!activeBroker && proxyBroker && (
                        <span className="text-[9px] text-muted-foreground font-normal">.env</span>
                      )}
                      <ChevronDown className="h-3 w-3 opacity-50 shrink-0" />
                    </>
                  )}
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent side="right" align="end" className="w-52">
                <div className="px-2 py-1.5 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Select Broker</div>

                {optionChainBrokers.map(b => {
                  const info = BROKERS.find(bi => bi.id === b.brokerId);
                  const isActive = effectiveBrokerId === b.brokerId;
                  return (
                    <DropdownMenuItem
                      key={b.brokerId}
                      onClick={() => handleSwitchBroker(b.brokerId)}
                      className={`text-xs gap-2 ${isActive ? "bg-accent font-semibold" : ""}`}
                    >
                      <span>{info?.logo}</span>
                      <span className="flex-1 capitalize">{info?.name || b.brokerId}</span>
                      {isActive && <span className="text-primary text-[10px]">✓ Active</span>}
                    </DropdownMenuItem>
                  );
                })}

                {proxyBroker && !optionChainBrokers.find(b => b.brokerId === proxyBroker) && (
                  <>
                    {optionChainBrokers.length > 0 && <DropdownMenuSeparator />}
                    <DropdownMenuItem disabled className={`text-xs gap-2 ${effectiveBrokerId === proxyBroker ? "bg-accent font-semibold" : ""}`}>
                      <span>{BROKERS.find(b => b.id === proxyBroker)?.logo || "🔌"}</span>
                      <span className="flex-1 capitalize">{BROKERS.find(b => b.id === proxyBroker)?.name || proxyBroker}</span>
                      <span className="text-[9px] text-muted-foreground">.env</span>
                    </DropdownMenuItem>
                  </>
                )}

                {!proxyBroker && optionChainBrokers.length === 0 && (
                  <DropdownMenuItem disabled className="text-xs text-muted-foreground">
                    No broker configured
                  </DropdownMenuItem>
                )}

                <DropdownMenuSeparator />
                <DropdownMenuItem className="text-xs text-muted-foreground" onClick={() => navigate("/broker-settings")}>
                  Manage broker keys →
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarSeparator className="my-2 opacity-30" />

        <SidebarGroup>
          <SidebarGroupLabel className="text-2xs uppercase tracking-[0.15em] text-muted-foreground/50 px-2 mb-1 font-medium">Settings</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu className="space-y-0.5">{renderNavItems(settingItems)}</SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border p-2">
        <button
          onClick={toggleTheme}
          className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] text-sidebar-foreground transition-all duration-150 hover:bg-sidebar-accent hover:text-foreground w-full"
        >
          {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          {!collapsed && <span>{isDark ? "Light Mode" : "Dark Mode"}</span>}
        </button>
      </SidebarFooter>
    </Sidebar>
  );
}
