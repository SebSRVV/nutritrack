import { Component, ChangeDetectionStrategy } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import {
  trigger, transition, style, animate, query, stagger, group, animateChild
} from '@angular/animations';
import {
  LucideAngularModule,
  ActivityIcon, AppleIcon, GoalIcon, DropletsIcon, BarChart3Icon
} from 'lucide-angular';

@Component({
  standalone: true,
  selector: 'nt-home',
  imports: [RouterLink, RouterLinkActive, LucideAngularModule],
  templateUrl: './home.page.html',
  styleUrls: ['./home.page.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  animations: [
    trigger('page', [
      transition(':enter', [
        style({ opacity: 0, transform: 'translateY(14px)' }),
        animate('480ms cubic-bezier(.16,1,.3,1)', style({ opacity: 1, transform: 'none' })),
        query('@staggerCards', animateChild(), { optional: true }),
      ]),
    ]),
    trigger('heroBits', [
      transition(':enter', [
        query('.hero-bit', [
          style({ opacity: 0, transform: 'translateY(10px) scale(.985)' }),
          stagger(70, animate('420ms cubic-bezier(.16,1,.3,1)', style({ opacity: 1, transform: 'none' }))),
        ], { optional: true }),
      ]),
    ]),
    trigger('staggerCards', [
      transition(':enter', [
        query('.card', [
          style({ opacity: 0, transform: 'translateY(14px) scale(.975)' }),
          stagger(100, animate('460ms cubic-bezier(.16,1,.3,1)', style({ opacity: 1, transform: 'none' }))),
        ], { optional: true }),
      ]),
    ]),
    trigger('glow', [
      transition(':enter', [
        style({ opacity: 0 }),
        group([
          animate('700ms ease-out', style({ opacity: .9 })),
          animate('2600ms 200ms ease-in-out', style({ opacity: .35 })),
        ]),
      ]),
    ]),
  ],
})
export default class HomePage {
  readonly ActivityIcon = ActivityIcon;
  readonly AppleIcon = AppleIcon;
  readonly GoalIcon = GoalIcon;
  readonly DropletsIcon = DropletsIcon;
  readonly BarChart3Icon = BarChart3Icon;

  readonly year = new Date().getFullYear();
}
