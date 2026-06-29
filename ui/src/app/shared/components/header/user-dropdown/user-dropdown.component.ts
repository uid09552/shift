import { Component, OnInit } from '@angular/core';
import { DropdownComponent } from '../../ui/dropdown/dropdown.component';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { UserService, UserInfo } from '../../../services/user.service';

@Component({
  selector: 'app-user-dropdown',
  templateUrl: './user-dropdown.component.html',
  imports: [CommonModule, RouterModule, DropdownComponent],
})
export class UserDropdownComponent implements OnInit {
  isOpen = false;
  userInfo: UserInfo = {};

  constructor(private userService: UserService) {}

  ngOnInit() {
    this.userService.getSelf().subscribe({
      next: (info) => (this.userInfo = info),
      error: () => {},
    });
  }

  get displayName(): string {
    return this.userInfo.name ?? this.userInfo.preferred_username ?? '';
  }

  get displayEmail(): string {
    return this.userInfo.email ?? '';
  }

  toggleDropdown() {
    this.isOpen = !this.isOpen;
  }

  closeDropdown() {
    this.isOpen = false;
  }

  signOut() {
    window.location.href = '/logout';
  }
}
