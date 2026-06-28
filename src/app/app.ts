import { Component, inject } from '@angular/core';
import { RouterOutlet, RouterLink, Router } from '@angular/router';
import { AuthService } from './services/auth-service';

@Component({
  selector: 'app-root',
  standalone: true,
  // We include Router directives so routerLink and router-outlet work out of the box
  imports: [RouterOutlet, RouterLink], 
  templateUrl: './app.html'
})
export class App {
  // Injecting our core authentication provider
  public authService = inject(AuthService);
  private router = inject(Router);

  /**
   * Clears the current operational token and routes the user back to the gate screen
   */
  async onLogout(): Promise<void> {
    try {
      await this.authService.signOut();
      this.router.navigate(['/login']);
    } catch (err: any) {
      console.error('Logout failed:', err.message);
    }
  }
}