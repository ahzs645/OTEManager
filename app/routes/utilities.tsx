import { createFileRoute, Outlet } from '@tanstack/react-router'

export const Route = createFileRoute('/utilities')({
  component: UtilitiesLayout,
})

function UtilitiesLayout() {
  return <Outlet />
}
