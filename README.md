# dotfiles

## Terminal Start Test

To test the startup time of the terminal, run the following command:

```
for i in $(seq 1 10); do /usr/bin/time $SHELL -i -c exit; done ;
```

