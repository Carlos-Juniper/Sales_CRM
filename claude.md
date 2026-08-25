# Programming Rules for Sales CRM

## Critical Rules

### 1. NO MOCK DATA
- **Never** implement mock data, mock handlers, or mock API responses in production code
- Always implement real API endpoints and database integration
- Mock data is acceptable ONLY in tests or temporary development
- Remove all mock imports and handlers before completion

### 2. Use Framework Features First
- **TanStack Query**: Use built-in `onMutate`, `onError`, `onSuccess` for optimistic updates
  - Never create custom optimistic update logic in stores
  - Never manually merge optimistic state in components
- **React Query**: Always invalidate/refetch after mutations
- Let the framework handle what it's designed for

### 3. API Integration
- Create typed API functions in `src/api/`
- Create React Query hooks in `src/hooks/`
- Always handle loading, error, and success states
- Use proper TypeScript types for requests and responses

### 4. State Management
- **TanStack Query** for server state (fetching, caching, synchronization)
- **Zustand** for client state only (UI state, temporary selections)
- Never duplicate server data in Zustand stores

### 5. TypeScript
- Define interfaces for all data models in `@/types/`
- Use strict mode (`noImplicitAny`, `strictNullChecks`)
- Avoid `any` - use `unknown` if type is genuinely unknown
- Export types alongside API functions

### 6. Component Patterns
- Components consume hooks, not direct API calls
- Keep business logic in hooks, not components
- Use controlled components with proper form state

### 7. Error Handling
- Always display user-friendly error messages
- Log errors for debugging
- Handle network failures gracefully
- Implement proper rollback for failed optimistic updates

### 8. Code Organization
```
src/
  api/          → API client functions
  hooks/        → React Query hooks
  components/   → Reusable UI components
  views/        → Page-level components
  types/        → TypeScript interfaces
  store/        → Zustand stores (client state only)
  lib/          → Utilities and helpers
```
## Testing Requirements
- Test with real API integration before marking complete
- Verify loading states render correctly
- Test error scenarios and rollback behavior
- Check that optimistic updates work and roll back on failure

## Before Completion Checklist
- [ ] All mock data removed
- [ ] Real API endpoints implemented and tested
- [ ] TypeScript types defined
- [ ] Loading and error states handled
- [ ] Optimistic updates use framework features
- [ ] Query keys properly structured for cache invalidation