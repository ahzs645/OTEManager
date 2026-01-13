import { createFileRoute, redirect } from '@tanstack/react-router'

// Redirect to utilities/import page where import is now located
export const Route = createFileRoute('/import')({
  beforeLoad: () => {
    throw redirect({
      to: '/utilities/import',
    })
  },
})
