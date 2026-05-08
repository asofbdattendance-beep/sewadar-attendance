import React, { useState, useEffect, useRef } from 'react'
import { supabase, ROLES, ROLE_LABELS } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../components/Toast'
import { logAction } from '../lib/logger'
import { Settings, Plus, Pencil, Trash2, X, Save, Users, MapPin, Shield, Building, Search, Copy, CheckCircle, UserPlus, FileText, ChevronRight, ChevronDown } from 'lucide-react'

const TABLES = [
  { id: 'centres', label: 'Centres', icon: MapPin, 
    columns: ['name', 'parent_centre', 'latitude', 'longitude', 'geo_radius', 'geo_enabled', 'is_active'], 
    sortBy: 'name', defaults: { is_active: true, geo_enabled: true, geo_radius: 200 } },
  { id: 'jatha_master', label: 'Jatha Master', icon: Shield, columns: ['jatha_type', 'centre_name', 'department', 'is_active'],
    sortBy: 'centre_name', defaults: { is_active: true } },
  { id: 'role_masters', label: 'Roles', icon: Shield, columns: ['role_key', 'role_label', 'role_description', 'permissions', 'is_active'],
    sortBy: 'role_label', defaults: { permissions: {}, is_active: true } },
  { id: 'special_departments', label: 'Departments', icon: Building, columns: ['department_name'],
    sortBy: 'department_name', defaults: {} },
  { id: 'users', label: 'Users', icon: Users, columns: ['name', 'email', 'badge_number', 'role', 'centre', 'permissions', 'is_active'],
    sortBy: 'name', defaults: { is_active: true, permissions: {} } },
  { id: 'logs', label: 'Logs', icon: FileText, 
    columns: ['id', 'user_badge', 'user_name', 'action', 'details', 'timestamp'],
    sortBy: 'timestamp', defaults: {} },
]

const PERMISSIONS_LIST = [
  { key: 'allow_dashboard', label: 'Allow Dashboard' },
  { key: 'allow_records', label: 'Allow Records' },
  { key: 'allow_scan', label: 'Allow Scanning' },
  { key: 'allow_gate_entry', label: 'Allow Gate Entry' },
  { key: 'allow_jatha', label: 'Allow Jatha Entry' },
  { key: 'allow_reports', label: 'Allow Reports' },
]

function SkeletonRow({ cols }) {
  return (
    <tr>
      {Array(cols + 1).fill(0).map((_, i) => (
        <td key={i}><div className="skeleton" style={{ height: 16, width: '80%', borderRadius: 4 }} /></td>
      ))}
    </tr>
  )
}

function Modal({ isOpen, onClose, title, children }) {
  if (!isOpen) return null
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3>{title}</h3>
          <button className="modal-close" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  )
}

function PermissionToggle({ permissions, onChange }) {
  const perms = permissions || {}
  const toggle = (key) => {
    const updated = { ...perms, [key]: !perms[key] }
    onChange(updated)
  }
  return (
    <div className="permission-grid">
      {PERMISSIONS_LIST.map(p => (
        <label key={p.key} className="permission-item">
          <input
            type="checkbox"
            checked={!!perms[p.key]}
            onChange={() => toggle(p.key)}
          />
          <span>{p.label}</span>
        </label>
      ))}
    </div>
  )
}

function FormFields({ table, formData, setFormData, centres, isUsersTable, roleLabelMap }) {
  return (
    <div className="form-fields-wrapper">
      {table.columns.map(col => (
        <div key={col} className="form-group">
          <label>{col.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}</label>
          
          {col === 'is_active' ? (
            <select
              value={formData[col] === true ? 'true' : formData[col] === false ? 'false' : ''}
              onChange={e => setFormData({ ...formData, [col]: e.target.value === 'true' })}
            >
              <option value="true">Active</option>
              <option value="false">Inactive</option>
            </select>
          ) : col === 'role' ? (
            <select
              value={formData[col] || ''}
              onChange={e => {
                const newRole = e.target.value
                setFormData({ ...formData, [col]: newRole })
                if (newRole) {
                  supabase.from('role_masters').select('permissions').eq('role_key', newRole).single().then(({ data }) => {
                    if (data?.permissions) {
                      setFormData(prev => ({ ...prev, permissions: data.permissions }))
                    }
                  })
                }
              }}
              required
            >
              <option value="">Select Role</option>
              {Object.entries(roleLabelMap).map(([key, label]) => (
                <option key={key} value={key}>{label}</option>
              ))}
            </select>
          ) : col === 'jatha_type' ? (
            <select
              value={formData[col] || ''}
              onChange={e => setFormData({ ...formData, [col]: e.target.value })}
              required={table.id === 'jatha_master'}
            >
              <option value="">Select Type</option>
              <option value="beas">BEAS</option>
              <option value="major_centre">Major Centre</option>
              <option value="jatha_home">Jatha Home</option>
            </select>
          ) : col === 'centre' ? (
            <select
              value={formData[col] || ''}
              onChange={e => setFormData({ ...formData, [col]: e.target.value })}
              required={table.id === 'users'}
            >
              <option value="">Select Centre</option>
              {centres.map(c => (
                <option key={c.name} value={c.name}>{c.name}</option>
              ))}
            </select>
          ) : col === 'parent_centre' ? (
            <select
              value={formData[col] || ''}
              onChange={e => setFormData({ ...formData, [col]: e.target.value })}
            >
              <option value="">None (Root)</option>
              {centres.filter(c => c.name !== formData.name).map(c => (
                <option key={c.name} value={c.name}>{c.name}</option>
              ))}
            </select>
          ) : col === 'role_key' ? (
            <input
              type="text"
              value={formData[col] || ''}
              onChange={e => setFormData({ ...formData, [col]: e.target.value })}
              placeholder="e.g., super_admin"
              required
            />
          ) : col === 'role_label' ? (
            <input
              type="text"
              value={formData[col] || ''}
              onChange={e => setFormData({ ...formData, [col]: e.target.value })}
              placeholder="e.g., Super Admin"
              required
            />
          ) : col === 'role_description' ? (
            <input
              type="text"
              value={formData[col] || ''}
              onChange={e => setFormData({ ...formData, [col]: e.target.value })}
              placeholder="Optional description"
            />
          ) : col === 'permissions' && (isUsersTable || table.id === 'role_masters') ? (
            <PermissionToggle 
              permissions={formData.permissions} 
              onChange={(perms) => setFormData({ ...formData, permissions: perms })} 
            />
          ) : col === 'permissions' ? (
            <input
              type="text"
              value={typeof formData[col] === 'string' ? formData[col] : JSON.stringify(formData[col] || {})}
              onChange={e => {
                try { setFormData({ ...formData, [col]: JSON.parse(e.target.value) }) } 
                catch { setFormData({ ...formData, [col]: e.target.value }) }
              }}
              placeholder='{"all": true}'
              className="font-mono"
            />
          ) : (
            <input
              type="text"
              value={formData[col] || ''}
              onChange={e => setFormData({ ...formData, [col]: e.target.value })}
              required={col === 'name' || col === 'department_name' || col === 'centre_name' || col === 'department'}
            />
          )}
        </div>
      ))}
    </div>
  )
}

export default function SuperAdminPage() {
  const { profile } = useAuth()
  const toast = useToast()
  const [activeTable, setActiveTable] = useState(TABLES[0].id)
  const [data, setData] = useState({})
  const [loading, setLoading] = useState({})
  const [search, setSearch] = useState('')
  const [modal, setModal] = useState({ open: false, mode: 'add', data: null })
  const [formData, setFormData] = useState({})
  const [centres, setCentres] = useState([])
  const [roleLabelMap, setRoleLabelMap] = useState({})
  const [sewadarSearch, setSewadarSearch] = useState('')
  const [sewadarResults, setSewadarResults] = useState([])
  const [selectedSewadar, setSelectedSewadar] = useState(null)
  const [generatedPassword, setGeneratedPassword] = useState('')
  const [showSuccess, setShowSuccess] = useState(false)
  const [successData, setSuccessData] = useState(null)
  const [expandedLog, setExpandedLog] = useState(null)
  const sewadarSearchTimeout = useRef(null)

  const currentTable = TABLES.find(t => t.id === activeTable)
  const isSuperAdmin = profile?.role === ROLES.SUPER_ADMIN || profile?.role === 'super_admin'
  const canAccessPanel = isSuperAdmin || profile?.role === 'aso'
  const canWrite = isSuperAdmin

  useEffect(() => {
    if (!canAccessPanel) return
    fetchData(activeTable)
  }, [activeTable, canAccessPanel])

  useEffect(() => {
    if (canAccessPanel) fetchCentres()
  }, [canAccessPanel])

  useEffect(() => {
    if (canAccessPanel) {
      supabase.from('role_masters').select('role_key, role_label').then(({ data }) => {
        if (data) {
          const map = {}
          data.forEach(r => { map[r.role_key] = r.role_label.replace(/_/g, ' ') })
          setRoleLabelMap(map)
        }
      })
    }
  }, [canAccessPanel])

  const fetchCentres = async () => {
    const { data: centresData } = await supabase.from('centres').select('name').order('name')
    setCentres(centresData || [])
  }

  const generatePassword = (centre, badge) => {
    if (!centre || !badge) return ''
    const prefix = centre.replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase()
    const suffix = badge.slice(-4)
    return prefix + suffix
  }

  const searchSewadar = async (query) => {
    const term = query.replace(/[%_]/g, '').trim()
    if (term.length < 2) {
      setSewadarResults([])
      return
    }
    const { data } = await supabase
      .from('sewadars')
      .select('badge_number, sewadar_name, centre, department')
      .or(`badge_number.ilike.%${term}%,sewadar_name.ilike.%${term}%`)
      .limit(10)
    setSewadarResults(data || [])
  }

  const fetchData = async (tableId) => {
    setLoading(l => ({ ...l, [tableId]: true }))
    try {
      const sortField = TABLES.find(t => t.id === tableId)?.sortBy || 'id'
      const ascending = tableId !== 'logs'
      const { data: result } = await supabase.from(tableId).select('*').order(sortField, { ascending })
      setData(d => ({ ...d, [tableId]: result || [] }))
    } catch (err) {
      console.error('Fetch error:', err)
      toast.error('Failed to fetch data')
    }
    setLoading(l => ({ ...l, [tableId]: false }))
  }

  // For users and role_masters tables - parse permissions from JSON to object for display
  const tableData = data[activeTable]?.map(row => {
    if ((activeTable === 'users' || activeTable === 'role_masters') && row.permissions) {
      return {
        ...row,
        permissions: typeof row.permissions === 'string' 
          ? JSON.parse(row.permissions) 
          : row.permissions
      }
    }
    return row
  }) || []
      
      const filteredData = tableData.filter(row => {
    if (!search) return true
    const searchLower = search.toLowerCase()
    return currentTable.columns.some(col => {
      const val = row[col]
      return val && String(val).toLowerCase().includes(searchLower)
    })
  })

  const handleAdd = () => {
    setSelectedSewadar(null)
    setSewadarSearch('')
    setSewadarResults([])
    setGeneratedPassword('')
    setShowSuccess(false)
    setSuccessData(null)

    const empty = { ...currentTable.defaults } || {}
    currentTable.columns.forEach(col => {
      if (!(col in empty)) {
        if (col === 'is_active') empty[col] = true
        else if (col === 'permissions') empty[col] = {}
        else empty[col] = ''
      }
    })
    setFormData(empty)
    setModal({ open: true, mode: 'add', data: null })
  }

  const handleEdit = (row) => {
    setFormData({ ...row })
    setModal({ open: true, mode: 'edit', data: row })
  }

  const handleDelete = async (row) => {
    if (!canWrite) { toast.error('You do not have write access'); return }
    const deleteName = row.name || row.role_label || row.department_name || row.centre_name || row.badge_number
    const confirmed = window.confirm(`Delete "${deleteName}"?`)
    if (!confirmed) return
    try {
      await supabase.from(activeTable).delete().eq('id', row.id)
      toast.success('Deleted successfully')
      logAction(profile?.badge_number, profile?.name, 'ADMIN_DELETE', { table: activeTable, id: row.id, name: deleteName, deleted_record: row })
      fetchData(activeTable)
    } catch (err) {
      console.error('Delete error:', err)
      toast.error('Failed to delete')
    }
  }

  const handleSubmit = async () => {
    if (!canWrite) { toast.error('You do not have write access'); return }
    try {
      const payload = { ...formData }
      
      // For users table - don't send role if it's empty, handle permissions
      if (activeTable === 'users') {
        if (!payload.role) delete payload.role
        // Auto-sync permissions from role_masters
        if (payload.role) {
          const { data: rolePerms } = await supabase.from('role_masters').select('permissions').eq('role_key', payload.role).single()
          if (rolePerms?.permissions) {
            payload.permissions = typeof rolePerms.permissions === 'string' ? JSON.parse(rolePerms.permissions) : rolePerms.permissions
          }
        }
        // Convert permissions object to JSON string for storage
        if (payload.permissions && typeof payload.permissions === 'object') {
          payload.permissions = JSON.stringify(payload.permissions)
        }
      }
      
      if (activeTable === 'role_masters' && payload.permissions) {
        if (typeof payload.permissions === 'string') {
          try { payload.permissions = JSON.parse(payload.permissions) } catch {}
        }
        // Ensure permissions is an object for JSONB column
        if (typeof payload.permissions !== 'object' || payload.permissions === null) {
          payload.permissions = {}
        }
      }
      
      // Filter out undefined/null values - but keep id for update
      const isUpdate = modal.mode === 'edit'
      Object.keys(payload).forEach(key => {
        if (payload[key] === undefined || payload[key] === null) delete payload[key]
      })
      
      let result
      const { id: _, created_at, auth_id, email, ...updatePayload } = payload
      
      if (modal.mode === 'add') {
        result = await supabase.from(activeTable).insert([payload]).select()
      } else {
        // For update, don't include id, created_at, auth_id, email in payload (read-only fields)
        
        // Try direct update using the client
        result = await supabase.from(activeTable).update(updatePayload).eq('id', formData.id)
        
        // If that didn't work, try via RPC (fallback)
        if (!result.error && (!result.data || result.data === null)) {
          // For users table specifically, try a different approach
          if (activeTable === 'users') {
            const rpcResult = await supabase.rpc('update_user_permissions', {
              p_id: formData.id,
              p_name: updatePayload.name,
              p_badge_number: updatePayload.badge_number,
              p_role: updatePayload.role,
              p_centre: updatePayload.centre,
              p_is_active: updatePayload.is_active,
              p_permissions: updatePayload.permissions
            })
            result = rpcResult
          }
        }
      }

      if (result.error) {
        console.error('Save error:', result.error)
        toast.error(result.error.message)
        return
      }

      // When role_masters permissions are updated, cascade to all users with that role
      if (activeTable === 'role_masters' && modal.mode === 'edit') {
        const roleKey = formData.role_key
        const newPerms = updatePayload.permissions || {}
        const { error: cascadeError } = await supabase
          .from('users')
          .update({ permissions: newPerms })
          .eq('role', roleKey)
        if (cascadeError) {
          console.error('Cascade error:', cascadeError)
        } else {
          const { count } = await supabase.from('users').select('*', { count: 'exact', head: true }).eq('role', roleKey)
          toast.success(`Role updated — ${count || 0} users synced`)
          logAction(profile?.badge_number, profile?.name, 'ROLE_CASCADE', { role: roleKey, count: count || 0 })
          await fetchData('users')
        }
      }

      if (activeTable === 'users' && modal.mode === 'add') {
        logAction(profile?.badge_number, profile?.name, 'USER_CREATED', { name: formData.name, email: formData.email, badge: formData.badge_number, role: formData.role, centre: formData.centre })
        const pwd = generatedPassword || generatePassword(formData.centre, formData.badge_number)
        setSuccessData({
          name: formData.name,
          email: formData.email,
          badge: formData.badge_number,
          centre: formData.centre,
          role: formData.role,
          password: pwd,
          created_at: new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })
        })
        setShowSuccess(true)
      } else if (modal.mode === 'add') {
        logAction(profile?.badge_number, profile?.name, 'ADMIN_ADD', { table: activeTable, name: formData.name || formData.centre_name || formData.role_key || formData.department_name, id: result.data?.[0]?.id })
        toast.success('Added successfully')
        setModal({ open: false, mode: 'add', data: null })
        setTimeout(() => fetchData(activeTable), 300)
      } else {
        logAction(profile?.badge_number, profile?.name, 'ADMIN_EDIT', { table: activeTable, id: formData.id, name: formData.name || formData.centre_name || formData.role_key || formData.department_name })
        toast.success('Updated successfully')
        setModal({ open: false, mode: 'add', data: null })
        setTimeout(() => fetchData(activeTable), 300)
      }
    } catch (err) {
      console.error('Save error:', err)
      toast.error(err.message)
    }
  }

  if (!canAccessPanel) {
    return (
      <div className="page-full" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}>
        <div style={{ textAlign: 'center', color: '#9ca3af' }}>
          <Shield size={48} style={{ marginBottom: 12, opacity: 0.5 }} />
          <p>Access denied. ASO only.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="page-full pb-nav">
      <div className="header" style={{ background: 'white', padding: '16px', borderBottom: '1px solid #e5e7eb' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <Settings size={22} style={{ color: '#6366f1' }} />
            <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: '#111827' }}>Admin Panel</h2>
          </div>
          {activeTable !== 'logs' && canWrite && (
            <button className="btn-primary" onClick={handleAdd} style={{ padding: '10px 18px', fontSize: 14 }}>
              <Plus size={16} /> Add New
            </button>
          )}
        </div>
      </div>

      <div className="superadmin-tabs" style={{ background: 'white' }}>
        {TABLES.map(table => (
          <button
            key={table.id}
            className={`tab-btn ${activeTable === table.id ? 'active' : ''}`}
            onClick={() => { setActiveTable(table.id); setSearch(''); setExpandedLog(null) }}
          >
            <table.icon size={15} />
            <span>{table.label}</span>
          </button>
        ))}
      </div>

      <div className="superadmin-toolbar">
        <div className="search-box">
          <Search size={16} />
          <input 
            type="text" 
            placeholder={`Search ${currentTable.label.toLowerCase()}...`}
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        {!loading[activeTable] && (
          <span className="table-count">{filteredData.length} of {data[activeTable]?.length || 0} records</span>
        )}
      </div>

      <div className="superadmin-table-wrap">
        <table className="superadmin-table">
          <thead>
            <tr>
              {activeTable === 'logs' && <th style={{ width: 40 }}></th>}
              {currentTable.columns.filter(col => activeTable !== 'logs' || col !== 'details').map(col => (
                <th key={col}>{col.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}</th>
              ))}
              {activeTable !== 'logs' && canWrite && <th style={{ width: 80 }}>Actions</th>}
            </tr>
          </thead>
          <tbody>
            {loading[activeTable] ? (
              <SkeletonRow cols={currentTable.columns.length} />
            ) : filteredData.length === 0 ? (
              <tr><td colSpan={currentTable.columns.length + (activeTable !== 'logs' && canWrite ? 1 : 0)} style={{ textAlign: 'center', padding: 40, color: '#9ca3af' }}>
                {search ? 'No matching records' : 'No data yet'}
              </td></tr>
            ) : (
              filteredData.map(row => (
                <React.Fragment key={row.id}>
                  <tr className={expandedLog === row.id ? 'expanded' : ''}>
                    {activeTable === 'logs' && (
                      <td style={{ width: 40 }}>
                        <button className="btn-icon" onClick={() => setExpandedLog(expandedLog === row.id ? null : row.id)} title="Toggle details">
                          {expandedLog === row.id ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                        </button>
                      </td>
                    )}
                    {currentTable.columns.filter(col => activeTable !== 'logs' || col !== 'details').map(col => (
                      <td key={col}>
                        {col === 'is_active' ? (
                          <span className={`status-dot ${row[col] ? 'active' : 'inactive'}`}>
                            {row[col] ? 'Active' : 'Inactive'}
                          </span>
                        ) : col === 'permissions' && (activeTable === 'users' || activeTable === 'role_masters') ? (
                          <span style={{ fontSize: 12, color: '#6b7280' }}>
                            {(() => {
                              let p = row[col]
                              if (typeof p === 'string') {
                                try { p = JSON.parse(p) } catch { p = {} }
                              }
                              p = p || {}
                              const enabled = Object.entries(p).filter(([k, v]) => v).map(([k]) => {
                                const perm = PERMISSIONS_LIST.find(x => x.key === k)
                                return perm ? perm.label.replace('Allow ', '') : k
                              })
                              return enabled.length > 0 ? enabled.join(', ') : 'None'
                            })()}
                          </span>
                        ) : col === 'permissions' ? (
                          <span className="cell-mono">{JSON.stringify(row[col] || {}).slice(0, 30)}</span>
                        ) : col === 'role_key' ? (
                          <span className="cell-mono">{row[col]}</span>
                        ) : col === 'role_label' && activeTable === 'role_masters' ? (
                          <span className={`role-pill ${row.role_key}`}>{(row[col] || '').replace(/_/g, ' ') || '—'}</span>
                        ) : col === 'role' ? (
                          <span className={`role-pill ${row[col]}`}>{roleLabelMap[row[col]] || ROLE_LABELS[row[col]] || row[col]}</span>
                        ) : col === 'jatha_type' ? (
                          <span className={`type-pill ${row[col]}`}>{row[col].replace('_', ' ')}</span>
                        ) : col === 'action' && activeTable === 'logs' ? (
                          <span className={`action-pill ${row[col]}`}>{row[col]}</span>
                        ) : col === 'timestamp' && activeTable === 'logs' ? (
                          <span style={{ fontSize: 12, color: '#6b7280', whiteSpace: 'nowrap' }}>
                            {new Date(row[col]).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                          </span>
                        ) : col === 'user_badge' && activeTable === 'logs' ? (
                          <span className="cell-mono">{row[col]}</span>
                        ) : col === 'user_name' && activeTable === 'logs' ? (
                          <span style={{ fontWeight: 500 }}>{row[col]}</span>
                        ) : (
                          row[col] || '—'
                        )}
                      </td>
                    ))}
                    {activeTable !== 'logs' && canWrite && (
                      <td>
                        <div className="action-btns">
                          <button className="btn-icon" onClick={() => handleEdit(row)} title="Edit">
                            <Pencil size={14} />
                          </button>
                          <button className="btn-icon btn-delete" onClick={() => handleDelete(row)} title="Delete">
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                  {activeTable === 'logs' && expandedLog === row.id && (
                    <tr className="expanded-detail-row">
                      <td colSpan={currentTable.columns.filter(col => col !== 'details').length + 1}>
                        <div className="log-detail-content">
                          <pre>{(() => {
                            try {
                              const d = JSON.parse(row.details)
                              return JSON.stringify(d, null, 2)
                            } catch {
                              return row.details || 'No details'
                            }
                          })()}</pre>
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))
            )}
          </tbody>
        </table>
      </div>

      <Modal
        isOpen={modal.open}
        onClose={() => { setModal({ open: false, mode: 'add', data: null }); setShowSuccess(false); setSelectedSewadar(null); setSewadarSearch(''); setSewadarResults([]); }}
        title={showSuccess ? 'User Created Successfully' : `${modal.mode === 'add' ? 'Add' : 'Edit'} ${currentTable.label}`}
      >
        {showSuccess && successData ? (
          <div className="user-success-card">
            <div className="user-success-header">
              <CheckCircle size={48} />
              <h3>User Created Successfully</h3>
            </div>

            <div className="user-success-details">
              <div className="user-success-row"><span>Name</span><strong>{successData.name}</strong></div>
              <div className="user-success-row"><span>Email</span><strong>{successData.email}</strong></div>
              <div className="user-success-row"><span>Badge No.</span><strong>{successData.badge}</strong></div>
              <div className="user-success-row"><span>Centre</span><strong>{successData.centre}</strong></div>
              <div className="user-success-row"><span>Role</span><strong className="role-pill" style={{ fontSize: 13, padding: '2px 10px' }}>{roleLabelMap[successData.role] || ROLE_LABELS[successData.role] || successData.role}</strong></div>
              <div className="user-success-row password-row">
                <span>Password</span>
                <div className="password-display">
                  <code>{successData.password}</code>
                  <button className="btn-icon" onClick={() => { navigator.clipboard.writeText(successData.password); toast.success('Password copied') }} title="Copy password"><Copy size={14} /></button>
                </div>
              </div>
              <div className="user-success-row"><span>Created</span><strong>{successData.created_at}</strong></div>
            </div>

            <div className="user-success-copy">
              <button className="btn-primary" onClick={() => {
                const msg = `✅ *New User Created*\n\n*Name:* ${successData.name}\n*Email:* ${successData.email}\n*Badge:* ${successData.badge}\n*Centre:* ${successData.centre}\n*Role:* ${successData.role}\n*Password:* ${successData.password}\n\n*Created:* ${successData.created_at}`
                navigator.clipboard.writeText(msg)
                toast.success('Copied to clipboard — ready to share on WhatsApp')
              }}>
                <Copy size={16} /> Copy All (WhatsApp)
              </button>
              <button className="btn-ghost" onClick={() => {
                setModal({ open: false, mode: 'add', data: null })
                setShowSuccess(false)
                setSelectedSewadar(null)
                setSewadarSearch('')
                setSewadarResults([])
                setTimeout(() => fetchData(activeTable), 300)
              }}>Close</button>
            </div>
          </div>
        ) : activeTable === 'users' && modal.mode === 'add' ? (
          <>
            {!selectedSewadar ? (
              <div className="sewadar-search-flow">
                <div className="form-group">
                  <label>Search Sewadar by Badge Number or Name</label>
                  <div className="sewadar-search">
                    <Search size={16} />
                    <input
                      type="text"
                      placeholder="Type badge number or name..."
                      value={sewadarSearch}
                      onChange={e => {
                        setSewadarSearch(e.target.value)
                        if (sewadarSearchTimeout.current) clearTimeout(sewadarSearchTimeout.current)
                        sewadarSearchTimeout.current = setTimeout(() => searchSewadar(e.target.value), 300)
                      }}
                      autoFocus
                    />
                  </div>
                </div>
                {sewadarResults.length > 0 && (
                  <div className="sewadar-results">
                    {sewadarResults.map(s => (
                      <div key={s.badge_number} className="sewadar-result-item" onClick={() => {
                        setSelectedSewadar(s)
                        const pwd = generatePassword(s.centre, s.badge_number)
                        setGeneratedPassword(pwd)
                        setFormData(prev => ({
                          ...prev,
                          name: s.sewadar_name,
                          badge_number: s.badge_number,
                          centre: s.centre,
                          email: ''
                        }))
                      }}>
                        <div className="info">
                          <div className="name">{s.sewadar_name}</div>
                          <div className="meta"><span className="badge">{s.badge_number}</span> — {s.centre}{s.department ? ` • ${s.department}` : ''}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                {sewadarSearch.length >= 2 && sewadarResults.length === 0 && (
                  <div style={{ textAlign: 'center', padding: 24, color: '#9ca3af', fontSize: 14 }}>No sewadar found</div>
                )}
              </div>
            ) : (
              <div className="user-add-form">
                <div className="selected-sewadar-chip" style={{ marginBottom: 16 }}>
                  <UserPlus size={16} />
                  <span className="name">{selectedSewadar.sewadar_name}</span>
                  <span className="badge">{selectedSewadar.badge_number}</span>
                  <span className="centre">{selectedSewadar.centre}</span>
                  <button className="btn-icon" onClick={() => { setSelectedSewadar(null); setSewadarSearch(''); setSewadarResults([]); }} title="Change"><X size={14} /></button>
                </div>
                <FormFields table={currentTable} formData={formData} setFormData={setFormData} centres={centres} isUsersTable={activeTable === 'users'} roleLabelMap={roleLabelMap} />
                <div className="password-auto">
                  <label>Auto-generated Password</label>
                  <div className="password-display">
                    <code>{generatedPassword}</code>
                    <button className="btn-icon" onClick={() => { navigator.clipboard.writeText(generatedPassword); toast.success('Password copied') }} title="Copy"><Copy size={14} /></button>
                    <button className="btn-ghost" style={{ fontSize: 12 }} onClick={() => {
                      const pwd = generatePassword(formData.centre || selectedSewadar.centre, formData.badge_number || selectedSewadar.badge_number)
                      setGeneratedPassword(pwd)
                    }}>Regenerate</button>
                  </div>
                  <div className="password-hint">Format: first 3 letters of centre (caps) + last 4 digits of badge number</div>
                </div>
              </div>
            )}
            {selectedSewadar && (
              <div className="modal-actions">
                <button className="btn-ghost" onClick={() => { setModal({ open: false, mode: 'add', data: null }); setSelectedSewadar(null); setSewadarSearch(''); setSewadarResults([]); }}>Cancel</button>
                <button className="btn-primary" onClick={handleSubmit}>
                  <UserPlus size={16} /> Create User
                </button>
              </div>
            )}
          </>
        ) : (
          <>
            <FormFields table={currentTable} formData={formData} setFormData={setFormData} centres={centres} isUsersTable={activeTable === 'users'} roleLabelMap={roleLabelMap} />
            <div className="modal-actions">
              <button className="btn-ghost" onClick={() => setModal({ open: false, mode: 'add', data: null })}>Cancel</button>
              <button className="btn-primary" onClick={handleSubmit}>
                <Save size={16} /> Save
              </button>
            </div>
          </>
        )}
      </Modal>
    </div>
  )
}