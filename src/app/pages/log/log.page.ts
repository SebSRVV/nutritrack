import { Component } from '@angular/core'; import { RouterLink } from '@angular/router';
@Component({ standalone: true, imports: [RouterLink], template: `<section class="container"><h1>Registro</h1><a routerLink="/">Volver</a></section>` })
export default class LogPage {}
