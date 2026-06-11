import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import App from './App';
import { AuthGate } from './components/AuthGate';
import { AdminPage } from './pages/Admin';
import { ApprovalsPage } from './pages/Approvals';
import { AuditLogPage } from './pages/AuditLog';
import { DashboardPage } from './pages/Dashboard';
import { DocumentsPage } from './pages/Documents';
import { NewTaskPage } from './pages/NewTask';
import { TaskDetailPage } from './pages/TaskDetail';
import { TasksPage } from './pages/Tasks';
import { WorkflowsPage } from './pages/Workflows';
import './styles.css';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});

const router = createBrowserRouter([
  {
    path: '/',
    element: <App />,
    children: [
      { index: true, element: <DashboardPage /> },
      { path: 'tasks', element: <TasksPage /> },
      { path: 'tasks/new', element: <NewTaskPage /> },
      { path: 'tasks/:id', element: <TaskDetailPage /> },
      { path: 'approvals', element: <ApprovalsPage /> },
      { path: 'workflows', element: <WorkflowsPage /> },
      { path: 'documents', element: <DocumentsPage /> },
      { path: 'audit', element: <AuditLogPage /> },
      { path: 'admin', element: <AdminPage /> },
    ],
  },
]);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthGate>
        <RouterProvider router={router} />
      </AuthGate>
    </QueryClientProvider>
  </React.StrictMode>,
);
