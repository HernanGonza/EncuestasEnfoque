import { useState } from 'react'
import { NavLink, useNavigate, Outlet } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'
import { useTheme } from '../../hooks/useTheme'
import { Sun, Moon } from 'lucide-react'
import styles from './SuperadminLayout.module.css'

const NAV = [
  { group: 'Panel',
    items: [
      { to: '/superadmin',                icon: '📊', label: 'Dashboard',       end: true },
    ]
  },
  { group: 'Clientes',
    items: [
      { to: '/superadmin/organizaciones', icon: '🏢', label: 'Organizaciones' },
      { to: '/superadmin/usuarios',       icon: '👤', label: 'Usuarios'       },
      { to: '/superadmin/suscripciones',  icon: '💳', label: 'Suscripciones'  },
    ]
  },
  { group: 'Producción',
    items: [
      { to: '/superadmin/encuestas',      icon: '📋', label: 'Encuestas'      },
    ]
  },
  { group: 'Online',
    items: [
      { to: '/superadmin/encuestas-online', icon: '🌐', label: 'Encuestas online' },
    ]
  },
]

export default function SuperadminLayout() {
  const { perfil, signOut } = useAuth()
  const { isDark, toggle } = useTheme()
  const navigate = useNavigate()
  const [collapsed, setCollapsed] = useState(false)

  const initials = (perfil?.nombre_completo || 'SA')
    .split(' ').slice(0, 2).map(n => n[0]).join('').toUpperCase()

  async function handleSignOut() {
    await signOut()
    navigate('/')
  }

  return (
    <div className={styles.layout}>
      <aside className={`${styles.sidebar} ${collapsed ? styles.collapsed : ''}`}>
        <div className={styles.brand}>
          <div className={styles.brandIcon}>SA</div>
          {!collapsed && (
            <div>
              <div className={styles.brandTitle}>Superadmin</div>
              <div className={styles.brandSub}>Panel de control</div>
            </div>
          )}
          <button className={styles.collapseBtn} onClick={() => setCollapsed(c => !c)}>
            {collapsed ? '→' : '←'}
          </button>
        </div>

        <nav className={styles.nav}>
          {NAV.map(({ group, items }) => (
            <div key={group} className={styles.navGroup}>
              {!collapsed && <div className={styles.navGroupLabel}>{group}</div>}
              {items.map(item => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) =>
                    `${styles.navItem} ${isActive ? styles.active : ''}`
                  }
                  title={collapsed ? item.label : undefined}
                >
                  <span className={styles.navIcon}>{item.icon}</span>
                  {!collapsed && <span>{item.label}</span>}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>

        <div className={styles.footer}>
          <div className={styles.userAvatar}>{initials}</div>
          {!collapsed && (
            <div className={styles.userInfo}>
              <div className={styles.userName}>{perfil?.nombre_completo || 'Superadmin'}</div>
              <div className={styles.userRole}>superadmin</div>
            </div>
          )}
          <button className={styles.themeBtn} onClick={toggle} title={isDark ? 'Modo claro' : 'Modo oscuro'}>
            {isDark ? <Sun size={14} /> : <Moon size={14} />}
          </button>
          <button className={styles.signOutBtn} onClick={handleSignOut} title="Cerrar sesión">↩</button>
        </div>
      </aside>

      <main className={styles.main}>
        <Outlet />
      </main>
    </div>
  )
}