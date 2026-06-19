import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { managementCompaniesApi, type CreateManagementCompanyPayload, type PatchManagementCompanyPayload, type PMContactBody, type PatchPMContactBody } from '@/api/managementCompanies'
import { useUIStore } from '@/store/uiStore'

export const MGMT_KEY = 'management-companies'

export function useManagementCompanies() {
  return useQuery({
    queryKey: [MGMT_KEY],
    queryFn: () => managementCompaniesApi.list({ page_size: 5000 }),
    select: (res) => res.data,
    staleTime: 30_000,
  })
}

export function useCreateManagementCompany() {
  const qc = useQueryClient()
  const toast = useUIStore((s) => s.toast)

  return useMutation({
    mutationFn: (body: CreateManagementCompanyPayload) => managementCompaniesApi.create(body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [MGMT_KEY] })
      toast('Company added', { variant: 'success' })
    },
    onError: () => toast('Failed to create company', { variant: 'error' }),
  })
}

export function usePatchManagementCompany() {
  const qc = useQueryClient()
  const toast = useUIStore((s) => s.toast)

  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: PatchManagementCompanyPayload }) =>
      managementCompaniesApi.patch(id, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: [MGMT_KEY] }),
    onError: () => toast('Failed to update company', { variant: 'error' }),
  })
}

export function useAddPMContact() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ companyId, body }: { companyId: string; body: PMContactBody }) =>
      managementCompaniesApi.addContact(companyId, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: [MGMT_KEY] }),
  })
}

export function useUpdatePMContact() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ companyId, contactId, body }: { companyId: string; contactId: string; body: PatchPMContactBody }) =>
      managementCompaniesApi.updateContact(companyId, contactId, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: [MGMT_KEY] }),
  })
}

export function useDeletePMContact() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ companyId, contactId }: { companyId: string; contactId: string }) =>
      managementCompaniesApi.deleteContact(companyId, contactId),
    onSuccess: () => qc.invalidateQueries({ queryKey: [MGMT_KEY] }),
  })
}
