'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { UserPlus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { api, ApiError, type Branch, type Department } from '@/lib/api';

// Mirror the API DTO's enum. CEO/Admin can be granted later; the invite
// flow seeds the new user with one of these four employee-side roles.
const ORG_ROLES = ['employee', 'supervisor', 'manager', 'hr'] as const;
type OrgRole = (typeof ORG_ROLES)[number];

type CreateUserBody = {
  email: string;
  firstName?: string;
  lastName?: string;
  orgRole?: OrgRole;
  branchId?: string;
  departmentId?: string;
};

type Permissions = { permissions: string[] };

function hasPerm(perms: string[], key: string): boolean {
  return perms.includes('*') || perms.includes(key);
}

// 'no-department' is a sentinel used by the Select component — it can't
// emit an empty string as a value, so we map it to undefined on submit.
const NONE = '__none__';

export function InvitePersonDialog() {
  const t = useTranslations('people.invite');
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);

  const [email, setEmail] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [orgRole, setOrgRole] = useState<OrgRole>('employee');
  const [branchId, setBranchId] = useState<string>(NONE);
  const [departmentId, setDepartmentId] = useState<string>(NONE);

  // Permission gate — only show the trigger button if the caller has
  // user.create. CEO/Admin via '*' and Manager/HR via the seed both pass.
  const { data: perms } = useQuery<Permissions>({
    queryKey: ['me', 'permissions'],
    queryFn: () => api.get('me/permissions'),
  });
  const canInvite = hasPerm(perms?.permissions ?? [], 'user.create');

  // Lookups for the dropdowns. We only fetch when the dialog opens so
  // the page-load cost isn't paid for users who never click Invite.
  const { data: branches } = useQuery<Branch[]>({
    queryKey: ['branches'],
    queryFn: () => api.get('branches'),
    enabled: open,
  });
  const { data: departments } = useQuery<Department[]>({
    queryKey: ['departments'],
    queryFn: () => api.get('departments'),
    enabled: open,
  });

  // Filter departments by the picked branch so we don't show e.g. an
  // Erbil department under a Baghdad branch selection.
  const filteredDepartments = useMemo(() => {
    if (!departments) return [];
    if (branchId === NONE) return departments;
    return departments.filter((d) => d.branchId === branchId);
  }, [departments, branchId]);

  const invite = useMutation({
    mutationFn: (body: CreateUserBody) => api.post('users', body),
    onSuccess: () => {
      toast.success(t('toast.success', { email }));
      // Refresh the /people listing so the new "invited" row shows up.
      queryClient.invalidateQueries({ queryKey: ['users'] });
      setOpen(false);
      // Reset so the next invite starts blank.
      setEmail('');
      setFirstName('');
      setLastName('');
      setOrgRole('employee');
      setBranchId(NONE);
      setDepartmentId(NONE);
    },
    onError: (err: unknown) => {
      const msg = err instanceof ApiError ? err.message : String((err as Error)?.message ?? '');
      toast.error(t('toast.error', { message: msg }));
    },
  });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    invite.mutate({
      email: email.trim(),
      firstName: firstName.trim() || undefined,
      lastName: lastName.trim() || undefined,
      orgRole,
      branchId: branchId === NONE ? undefined : branchId,
      departmentId: departmentId === NONE ? undefined : departmentId,
    });
  }

  if (!canInvite) return null;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <UserPlus className="me-2 h-4 w-4" />
          {t('trigger')}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="invite-email">{t('fields.email')}</Label>
            <Input
              id="invite-email"
              type="email"
              required
              placeholder={t('fields.emailPlaceholder')}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="invite-first">{t('fields.firstName')}</Label>
              <Input
                id="invite-first"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="invite-last">{t('fields.lastName')}</Label>
              <Input
                id="invite-last"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="invite-role">{t('fields.orgRole')}</Label>
            <Select value={orgRole} onValueChange={(v) => setOrgRole(v as OrgRole)}>
              <SelectTrigger id="invite-role">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ORG_ROLES.map((role) => (
                  <SelectItem key={role} value={role}>
                    {t(`roles.${role}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="invite-branch">{t('fields.branch')}</Label>
              <Select
                value={branchId}
                onValueChange={(v) => {
                  setBranchId(v);
                  // Reset dept when branch changes — picked dept may now
                  // belong to a different branch.
                  setDepartmentId(NONE);
                }}
              >
                <SelectTrigger id="invite-branch">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>{t('fields.none')}</SelectItem>
                  {(branches ?? []).map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      {b.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="invite-dept">{t('fields.department')}</Label>
              <Select value={departmentId} onValueChange={setDepartmentId}>
                <SelectTrigger id="invite-dept">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>{t('fields.none')}</SelectItem>
                  {filteredDepartments.map((d) => (
                    <SelectItem key={d.id} value={d.id}>
                      {d.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setOpen(false)}
              disabled={invite.isPending}
            >
              {t('cancel')}
            </Button>
            <Button type="submit" disabled={invite.isPending || !email}>
              {invite.isPending ? t('submitting') : t('submit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
