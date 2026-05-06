import { useState, useEffect } from 'react'
import { supabase, ROLES } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../components/Toast'
import { Settings, Plus, Pencil, Trash2, X, Save, Users, MapPin, Shield, Building, Search } from 'lucide-react'

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

function FormFields({ table, formData, setFormData, centres, isUsersTable }) {
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
              onChange={e => setFormData({ ...formData, [col]: e.target.value })}
              required
            >
              <option value="">Select Role</option>
              <option value="super_admin">ASO (Super Admin)</option>
              <option value="admin">Admin</option>
              <option value="centre_user">Centre Admin</option>
              <option value="sc_sp_user">Scanner</option>
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

  const currentTable = TABLES.find(t => t.id === activeTable)
  const isSuperAdmin = profile?.role === ROLES.SUPER_ADMIN || profile?.role === 'super_admin' || profile?.role === 'aso'

  useEffect(() => {
    if (!isSuperAdmin) return
    fetchData(activeTable)
  }, [activeTable, isSuperAdmin])

  useEffect(() => {
    if (isSuperAdmin) fetchCentres()
  }, [isSuperAdmin])

  const fetchCentres = async () => {
    const { data: centresData } = await supabase.from('centres').select('name').order('name')
    setCentres(centresData || [])
  }

  const fetchData = async (tableId) => {
    setLoading(l => ({ ...l, [tableId]: true }))
    try {
      const sortField = TABLES.find(t => t.id === tableId)?.sortBy || 'id'
      const { data: result } = await supabase.from(tableId).select('*').order(sortField, { ascending: true })
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
    const deleteName = row.name || row.role_label || row.department_name || row.centre_name || row.badge_number
    const confirmed = window.confirm(`Delete "${deleteName}"?`)
    if (!confirmed) return
    try {
      await supabase.from(activeTable).delete().eq('id', row.id)
      toast.success('Deleted successfully')
      fetchData(activeTable)
    } catch (err) {
      console.error('Delete error:', err)
      toast.error('Failed to delete')
    }
  }

  const handleSubmit = async () => {
    try {
      const payload = { ...formData }
      
      // For users table - don't send role if it's empty, handle permissions
      if (activeTable === 'users') {
        if (!payload.role) delete payload.role
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
          await fetchData('users')
        }
      }

      toast.success(modal.mode === 'add' ? 'Added successfully' : 'Updated successfully')
      setModal({ open: false, mode: 'add', data: null })
      
      // Refetch after short delay
      setTimeout(() => fetchData(activeTable), 300)
    } catch (err) {
      console.error('Save error:', err)
      toast.error(err.message)
    }
  }

  if (!isSuperAdmin) {
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
          <button className="btn-primary" onClick={handleAdd} style={{ padding: '10px 18px', fontSize: 14 }}>
            <Plus size={16} /> Add New
          </button>
        </div>
      </div>

      <div className="superadmin-tabs" style={{ background: 'white' }}>
        {TABLES.map(table => (
          <button
            key={table.id}
            className={`tab-btn ${activeTable === table.id ? 'active' : ''}`}
            onClick={() => { setActiveTable(table.id); setSearch('') }}
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
              {currentTable.columns.map(col => (
                <th key={col}>{col.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}</th>
              ))}
              <th style={{ width: 80 }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading[activeTable] ? (
              <SkeletonRow cols={currentTable.columns.length} />
            ) : filteredData.length === 0 ? (
              <tr><td colSpan={currentTable.columns.length + 1} style={{ textAlign: 'center', padding: 40, color: '#9ca3af' }}>
                {search ? 'No matching records' : 'No data yet'}
              </td></tr>
            ) : (
              filteredData.map(row => (
                <tr key={row.id}>
                  {currentTable.columns.map(col => (
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
                        <span className={`role-pill ${row[col]}`}>{row[col] === 'super_admin' ? 'ASO' : row[col] === 'admin' ? 'Admin' : row[col] === 'centre_user' ? 'Centre Admin' : row[col] === 'sc_sp_user' ? 'Scanner' : row[col].replace('_', ' ')}</span>
                      ) : col === 'role' ? (
                        <span className={`role-pill ${row[col]}`}>{row[col] === 'super_admin' ? 'ASO' : row[col] === 'admin' ? 'Admin' : row[col] === 'centre_user' ? 'Centre Admin' : row[col] === 'sc_sp_user' ? 'Scanner' : row[col].replace('_', ' ')}</span>
                      ) : col === 'jatha_type' ? (
                        <span className={`type-pill ${row[col]}`}>{row[col].replace('_', ' ')}</span>
                      ) : (
                        row[col] || '—'
                      )}
                    </td>
                  ))}
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
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <Modal
        isOpen={modal.open}
        onClose={() => setModal({ open: false, mode: 'add', data: null })}
        title={`${modal.mode === 'add' ? 'Add' : 'Edit'} ${currentTable.label}`}
      >
        <FormFields table={currentTable} formData={formData} setFormData={setFormData} centres={centres} isUsersTable={activeTable === 'users'} />
        <div className="modal-actions">
          <button className="btn-ghost" onClick={() => setModal({ open: false, mode: 'add', data: null })}>Cancel</button>
          <button className="btn-primary" onClick={handleSubmit}>
            <Save size={16} /> Save
          </button>
        </div>
      </Modal>
    </div>
  )
}