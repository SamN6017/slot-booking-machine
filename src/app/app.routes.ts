import { Routes, Router } from '@angular/router';
import { inject } from '@angular/core';
import { AuthService } from './services/auth-service';
import { Dashboard } from './components/dashboard/dashboard';
import { Login } from './components/login/login';

export const routes: Routes = [
  {
    path: 'login',
    component: Login
  },
  {
    path: 'dashboard',
    component: Dashboard,
    canActivate: [
      () => {
        const authService = inject(AuthService);
        const router = inject(Router);

        if (authService.isAuthenticated()) {
          return true;
        }

        return router.parseUrl('/login');
      }
    ]
  },
  { path: '', redirectTo: 'dashboard', pathMatch: 'full' }
];