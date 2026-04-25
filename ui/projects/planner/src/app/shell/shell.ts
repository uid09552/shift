import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { Navbar } from 'shared';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-shell',
  imports: [RouterOutlet, Navbar, CommonModule],
  templateUrl: './shell.html',
  styleUrl: './shell.css',
})
export class Shell {}
