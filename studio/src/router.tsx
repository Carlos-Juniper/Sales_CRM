import { createBrowserRouter, Navigate } from 'react-router-dom'
import { AppShell } from '@/components/layout/AppShell'
import { RequireAuth } from '@/views/auth/RoleGate'
import LoginPage from '@/views/auth/LoginPage'
import AuthCallbackPage from '@/views/auth/AuthCallbackPage'
import {
  DashboardPage, LeadFeedPage, BidTrackerPage,
  PipelinePage, MapPage, EstimatingPage, CalendarPage,
} from '@/views/inside-sales'
import AccountsPage from '@/views/inside-sales/AccountsPage'
import ConnectionsPage from '@/views/inside-sales/ConnectionsPage'
import BranchManagerPage from '@/views/branch-manager'
import { InsideSalesGuard } from '@/guards'

export const router = createBrowserRouter([
  {
    path: '/login',
    element: <LoginPage />,
  },
  {
    path: '/auth/callback',
    element: <AuthCallbackPage />,
  },
  {
    path: '/',
    element: <RequireAuth><AppShell /></RequireAuth>,
    children: [
      {
        index: true,
        element: <Navigate to="/inside-sales" replace />,
      },
      // Inside Sales
      {
        path: 'inside-sales',
        element: <InsideSalesGuard><DashboardPage /></InsideSalesGuard>,
      },
      {
        path: 'inside-sales/leads',
        element: <InsideSalesGuard><LeadFeedPage /></InsideSalesGuard>,
      },
      {
        path: 'inside-sales/bids',
        element: <InsideSalesGuard><BidTrackerPage /></InsideSalesGuard>,
      },
      {
        path: 'inside-sales/pipeline',
        element: <InsideSalesGuard><PipelinePage /></InsideSalesGuard>,
      },
      {
        path: 'inside-sales/map',
        element: <InsideSalesGuard><MapPage /></InsideSalesGuard>,
      },
      // The open estimate + active tab are real URL segments (not local
      // state) so a deep link / refresh / back-navigation never loses them —
      // see EstimatingPage.tsx + useEstimatingShell.ts. Four concrete routes
      // (rather than react-router's `:param?` optional-segment syntax) keep
      // matching unambiguous while all four share one element: bare queue,
      // queue at a specific tab (no estimate open — the literal `tab/`
      // segment disambiguates this from `:estimateId`), an open estimate at
      // its default tab, and an open estimate at a specific tab.
      {
        path: 'inside-sales/estimating',
        element: <InsideSalesGuard><EstimatingPage /></InsideSalesGuard>,
      },
      {
        path: 'inside-sales/estimating/tab/:tab',
        element: <InsideSalesGuard><EstimatingPage /></InsideSalesGuard>,
      },
      {
        path: 'inside-sales/estimating/:estimateId',
        element: <InsideSalesGuard><EstimatingPage /></InsideSalesGuard>,
      },
      {
        path: 'inside-sales/estimating/:estimateId/:tab',
        element: <InsideSalesGuard><EstimatingPage /></InsideSalesGuard>,
      },
      {
        path: 'inside-sales/accounts',
        element: <InsideSalesGuard><AccountsPage /></InsideSalesGuard>,
      },
      {
        path: 'inside-sales/calendar',
        element: <InsideSalesGuard><CalendarPage /></InsideSalesGuard>,
      },
      // Branch Manager (redirected — analytics now lives on dashboard)
      {
        path: 'branch-manager',
        element: <Navigate to="/inside-sales" replace />,
      },
      // Settings
      {
        path: 'settings',
        element: <RequireAuth><BranchManagerPage /></RequireAuth>,
      },
      {
        path: 'inside-sales/settings/connections',
        element: <InsideSalesGuard><ConnectionsPage /></InsideSalesGuard>,
      },
      // Catch-all
      {
        path: '*',
        element: <Navigate to="/" replace />,
      },
    ],
  },
])
