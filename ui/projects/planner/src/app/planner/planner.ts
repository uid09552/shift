import { Component } from '@angular/core';
import { MatSidenavModule } from '@angular/material/sidenav';
import { SidebarComponent } from 'shared';

@Component({
  selector: 'app-planner',
  imports: [MatSidenavModule, SidebarComponent],
  templateUrl: './planner.html',
  styleUrl: './planner.css',
})
export class Planner {}
