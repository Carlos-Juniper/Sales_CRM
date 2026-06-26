import { createBrowserRouter, Navigate } from 'react-router-dom'
import { AppShell } from '@/components/layout/AppShell'
import { RequireAuth } from '@/views/auth/RoleGate'
import LoginPage from '@/views/auth/LoginPage'
import AuthCallbackPage from '@/views/auth/AuthCallbackPage'
import {
  DashboardPage, LeadFeedPage, OutreachQueuePage, BidTrackerPage,
  PipelinePage, MapPage, EstimatingPage,
} from '@/views/inside-sales'
import AccountsPage from '@/views/inside-sales/AccountsPage'
import ConnectionsPage from '@/views/inside-sales/ConnectionsPage'
import OutsideSalesPage from '@/views/outside-sales'
import BranchManagerPage from '@/views/branch-manager'
import { InsideSalesGuard, OutsideSalesGuard } from '@/guards'

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
        path: 'inside-sales/outreach',
        element: <InsideSalesGuard><OutreachQueuePage /></InsideSalesGuard>,
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
      {
        path: 'inside-sales/estimating',
        element: <InsideSalesGuard><EstimatingPage /></InsideSalesGuard>,
      },
      {
        path: 'inside-sales/accounts',
        element: <InsideSalesGuard><AccountsPage /></InsideSalesGuard>,
      },
      // Outside Sales
      {
        path: 'outside-sales',
        element: <OutsideSalesGuard><OutsideSalesPage /></OutsideSalesGuard>,
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
