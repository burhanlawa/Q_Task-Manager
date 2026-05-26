'use client';

import { useQuery } from '@tanstack/react-query';
import { Link } from '@/i18n/routing';
import { Search } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { api, type Branch, type Department, type Team } from '@/lib/api';

type StatusFilter = 'active' | 'invited' | 'suspended' | 'deactivated' | 'all';

type DirectoryUser = {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  displayName: string | null;
  orgRole: string;
  status: string;
  branchId: string | null;
  departmentId: string | null;
};

const ALL = '__all__';

export function PeopleTable() {
  const t = useTranslations('people');
  const [status, setStatus] = useState<StatusFilter>('active');
  const [departmentId, setDepartmentId] = useState<string>(ALL);
  const [teamId, setTeamId] = useState<string>(ALL);
  const [q, setQ] = useState('');

  const { data: branches } = useQuery<Branch[]>({
    queryKey: ['branches', { status: 'active' }],
    queryFn: () => api.get('branches?status=active'),
  });
  const { data: departments } = useQuery<Department[]>({
    queryKey: ['departments', { status: 'active' }],
    queryFn: () => api.get('departments?status=active'),
  });
  const { data: teams } = useQuery<Team[]>({
    queryKey: ['teams', { status: 'active' }],
    queryFn: () => api.get('teams?status=active'),
  });

  const params = new URLSearchParams({ status });
  if (departmentId !== ALL) params.set('departmentId', departmentId);
  if (teamId !== ALL) params.set('teamId', teamId);

  const { data: users, isLoading, isError } = useQuery<DirectoryUser[]>({
    queryKey: ['users', { status, departmentId, teamId }],
    queryFn: () => api.get(`users?${params.toString()}`),
  });

  const filtered = useMemo(() => {
    if (!users) return [];
    const needle = q.trim().toLowerCase();
    if (!needle) return users;
    return users.filter((u) => {
      const name = `${u.firstName ?? ''} ${u.lastName ?? ''} ${u.displayName ?? ''}`.toLowerCase();
      return u.email.toLowerCase().includes(needle) || name.includes(needle);
    });
  }, [users, q]);

  const deptName = (id: string | null) =>
    id ? (departments?.find((d) => d.id === id)?.name ?? '—') : '—';
  const branchName = (id: string | null) =>
    id ? (branches?.find((b) => b.id === id)?.name ?? '—') : '—';

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="relative flex-1 min-w-[240px]">
          <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t('search')}
            className="ps-9"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-muted-foreground">{t('departmentLabel')}</label>
          <Select value={departmentId} onValueChange={setDepartmentId}>
            <SelectTrigger className="w-[200px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{t('allDepartments')}</SelectItem>
              {departments?.map((d) => (
                <SelectItem key={d.id} value={d.id}>
                  {d.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-muted-foreground">{t('teamLabel')}</label>
          <Select value={teamId} onValueChange={setTeamId}>
            <SelectTrigger className="w-[200px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{t('allTeams')}</SelectItem>
              {teams?.map((tm) => (
                <SelectItem key={tm.id} value={tm.id}>
                  {tm.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <Tabs value={status} onValueChange={(v) => setStatus(v as StatusFilter)}>
        <TabsList>
          <TabsTrigger value="active">{t('filter.active')}</TabsTrigger>
          <TabsTrigger value="invited">{t('filter.invited')}</TabsTrigger>
          <TabsTrigger value="suspended">{t('filter.suspended')}</TabsTrigger>
          <TabsTrigger value="deactivated">{t('filter.deactivated')}</TabsTrigger>
          <TabsTrigger value="all">{t('filter.all')}</TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('columns.name')}</TableHead>
              <TableHead>{t('columns.email')}</TableHead>
              <TableHead>{t('columns.orgRole')}</TableHead>
              <TableHead>{t('columns.branch')}</TableHead>
              <TableHead>{t('columns.department')}</TableHead>
              <TableHead>{t('columns.status')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                  {t('loading')}
                </TableCell>
              </TableRow>
            )}
            {isError && (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-destructive py-8">
                  {t('loadError')}
                </TableCell>
              </TableRow>
            )}
            {filtered.length === 0 && !isLoading && (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                  {t('empty')}
                </TableCell>
              </TableRow>
            )}
            {filtered.map((u) => (
              <TableRow key={u.id}>
                <TableCell className="font-medium">
                  <Link href={`/people/${u.id}`} className="hover:underline">
                    {u.displayName ??
                      `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim() ??
                      u.email}
                  </Link>
                </TableCell>
                <TableCell className="text-muted-foreground">{u.email}</TableCell>
                <TableCell>
                  <Badge variant="outline">{u.orgRole}</Badge>
                </TableCell>
                <TableCell>{branchName(u.branchId)}</TableCell>
                <TableCell>{deptName(u.departmentId)}</TableCell>
                <TableCell>
                  <Badge
                    variant={
                      u.status === 'active'
                        ? 'default'
                        : u.status === 'invited'
                          ? 'secondary'
                          : 'outline'
                    }
                  >
                    {t(`status.${u.status}` as 'status.active')}
                  </Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
