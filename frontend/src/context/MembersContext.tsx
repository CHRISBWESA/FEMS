import React, { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from 'react';
import axios from 'axios';

interface Member {
  id: string;
  full_name: string;
  member_code: string;
  email?: string;
  phone?: string;
  gender?: string;
  membership_status: string;
  departmentMemberships?: Array<{ department_id: string; department?: { id: string; name: string } }>;
  profile?: {
    skills?: string[];
    interests?: string[];
    service_interests?: string[];
    membership_date?: string;
  };
  created_at: string;
  leader_role?: string;
}

interface MemberListResponse {
  data: Member[];
  total: number;
}

interface MembersContextType {
  members: Member[];
  total: number;
  loading: boolean;
  error: string | null;
  fetchMembers: (params?: MemberFetchParams) => Promise<void>;
  refreshMembers: () => Promise<void>;
  getMemberById: (id: string) => Member | undefined;
  searchMembers: (search: string, limit?: number) => Promise<Member[]>;
  createMember: (data: CreateMemberData) => Promise<Member>;
  updateMember: (id: string, data: Partial<Member>) => Promise<Member>;
  deleteMember: (id: string) => Promise<void>;
}

interface MemberFetchParams {
  page?: number;
  limit?: number;
  search?: string;
  status?: string;
  departmentId?: string;
  groupId?: string;
  skills?: string;
  interests?: string;
  serviceInterests?: string;
  joinedFrom?: string;
  joinedTo?: string;
  attendance?: 'attended' | 'not_attended';
  days?: string;
}

interface CreateMemberData {
  fullName: string;
  gender: string;
  phone?: string;
  email?: string;
  programme?: string;
  yearOfStudy?: string;
  expectedGraduationYear?: number;
  expectedGraduationMonth?: number;
  departmentId?: string;
  departmentCustomFields?: Record<string, unknown>;
  fellowshipId?: string;
}

const MembersContext = createContext<MembersContextType | undefined>(undefined);

export function MembersProvider({ children }: { children: ReactNode }) {
  const [members, setMembers] = useState<Member[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastFetchParams, setLastFetchParams] = useState<Record<string, any> | null>(null);

  const fetchMembers = useCallback(async (fetchParams: MemberFetchParams = {}) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (fetchParams.page) params.set('page', fetchParams.page.toString());
      if (fetchParams.limit) params.set('limit', fetchParams.limit.toString());
      if (fetchParams.search) params.set('search', fetchParams.search);
      if (fetchParams.status) params.set('status', fetchParams.status);
      if (fetchParams.departmentId) params.set('departmentId', fetchParams.departmentId);
      if (fetchParams.groupId) params.set('groupId', fetchParams.groupId);
      if (fetchParams.skills) params.set('skills', fetchParams.skills);
      if (fetchParams.interests) params.set('interests', fetchParams.interests);
      if (fetchParams.serviceInterests) params.set('serviceInterests', fetchParams.serviceInterests);
      if (fetchParams.joinedFrom) params.set('joinedFrom', fetchParams.joinedFrom);
      if (fetchParams.joinedTo) params.set('joinedTo', fetchParams.joinedTo);
      if (fetchParams.attendance) params.set('attendance', fetchParams.attendance);
      if (fetchParams.days) params.set('days', fetchParams.days);
      params.set('page', (fetchParams.page || 1).toString());
      params.set('limit', (fetchParams.limit || 20).toString());

      const res = await axios.get(`/members?${params.toString()}`, { withCredentials: true });
      const data = res.data.data || res.data;
      const total = res.data.total || data.length;
      setMembers(data);
      setTotal(total);
      setLastFetchParams(params);
    } catch (err: any) {
      console.error('Failed to fetch members:', err);
      setError(err.response?.data?.message || 'Failed to fetch members');
    } finally {
      setLoading(false);
    }
  }, []);

  const refreshMembers = useCallback(async () => {
    if (lastFetchParams) {
      await fetchMembers(lastFetchParams);
    } else {
      await fetchMembers({});
    }
  }, [fetchMembers, lastFetchParams]);

  const getMemberById = useCallback((id: string): Member | undefined => {
    return members.find(m => m.id === id);
  }, [members]);

  const searchMembers = useCallback(async (search: string, limit = 8): Promise<Member[]> => {
    try {
      const res = await axios.get(`/members?limit=${limit}&search=${encodeURIComponent(search.trim())}`, { withCredentials: true });
      return res.data.data || res.data || [];
    } catch (err) {
      console.error('Failed to search members:', err);
      return [];
    }
  }, []);

  const createMember = useCallback(async (data: any): Promise<Member> => {
    const res = await axios.post('/members', data, { withCredentials: true });
    const member = res.data;
    setMembers(prev => [member, ...prev]);
    setTotal(prev => prev + 1);
    return member;
  }, []);

  const updateMember = useCallback(async (id: string, data: Partial<any>): Promise<Member> => {
    const res = await axios.put(`/members/${id}`, data, { withCredentials: true });
    const member = res.data;
    setMembers(prev => prev.map(m => m.id === id ? member : m));
    return member;
  }, []);

  const deleteMember = useCallback(async (id: string): Promise<void> => {
    await axios.delete(`/members/${id}`, { withCredentials: true });
    setMembers(prev => prev.filter(m => m.id !== id));
    setTotal(prev => prev - 1);
  }, []);

  // Auto-refresh when returning to the app or window gains focus
  useEffect(() => {
    const handleFocus = () => {
      if (lastFetchParams) {
        fetchMembers(lastFetchParams);
      }
    };
    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, [lastFetchParams, fetchMembers]);

  return (
    <MembersContext.Provider value={{
      members,
      total,
      loading,
      error,
      fetchMembers,
      refreshMembers,
      getMemberById,
      searchMembers,
      createMember,
      updateMember,
      deleteMember,
    }}>
      {children}
    </MembersContext.Provider>
  );
}

export function useMembers() {
  const ctx = useContext(MembersContext);
  if (!ctx) throw new Error('useMembers must be used within MembersProvider');
  return ctx;
}